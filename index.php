<?php

use Kirby\Cms\App;
use Kirby\Cms\Find;
use Kirby\Exception\InvalidArgumentException;
use Kirby\Exception\PermissionException;
use Kirby\Http\Response;
use Kirby\Toolkit\Str;
use Thomhines\KirbyRevisions\RevisionsService;
use Thomhines\KirbyRevisions\RevisionsViewButton;

@include_once __DIR__ . '/src/RevisionsService.php';
@include_once __DIR__ . '/src/RevisionsViewButton.php';

/**
 * Merges the Revisions view button into panel.viewButtons for page and site.
 * Runs on system.loadPlugins:after so config can omit panel.viewButtons entirely.
 * Uses reflection so merged numeric button lists are not overwritten by Kirby’s option merge rules.
 */
function thomhines_kirby_revisions_apply_view_buttons(App $kirby): void
{
	if ($kirby->option('thomhines.kirby-revisions.enabled', true) !== true) {
		return;
	}

	$ref = new \ReflectionObject($kirby);

	$optProp = $ref->getProperty('options');
	$optProp->setAccessible(true);
	$options = $optProp->getValue($kirby);

	$panel = $options['panel'] ?? [];
	$vb = is_array($panel) === true ? ($panel['viewButtons'] ?? null) : null;

	if ($vb === false) {
		return;
	}

	$vb = is_array($vb) === true ? $vb : [];

	$page = array_key_exists('page', $vb) === true ? $vb['page'] : null;
	$site = array_key_exists('site', $vb) === true ? $vb['site'] : null;

	if ($page === false && $site === false) {
		return;
	}

	// Fallbacks when a project doesn't define panel.viewButtons.
	$pageDefault = ['open', 'preview', '-', 'settings', 'languages', 'status'];
	$siteDefault = ['open', 'preview', 'languages'];

	if ($page !== false) {
		if ($page === null) {
			$page = $pageDefault;
		} elseif (is_array($page) !== true) {
			$page = $pageDefault;
		}

		if (in_array('revisions', $page, true) !== true) {
			$page = [...$page, '-', 'revisions'];
		}

		$page = array_values(
			array_filter($page, static fn ($b) => $b !== 'saveRevision')
		);
	}

	if ($site !== false) {
		if ($site === null) {
			$site = $siteDefault;
		} elseif (is_array($site) !== true) {
			$site = $siteDefault;
		}

		if (in_array('revisions', $site, true) !== true) {
			$site = [...$site, '-', 'revisions'];
		}

		$site = array_values(
			array_filter($site, static fn ($b) => $b !== 'saveRevision')
		);
	}

	$options['panel'] ??= [];

	if ($page !== false) {
		$options['panel']['viewButtons']['page'] = $page;
	}

	if ($site !== false) {
		$options['panel']['viewButtons']['site'] = $site;
	}

	$optProp->setValue($kirby, $options);

	// Keep extensions.options in sync with the reflected runtime options.
	$extProp = $ref->getProperty('extensions');
	$extProp->setAccessible(true);
	$extensions = $extProp->getValue($kirby);
	$extensions['options'] = $options;
	$extProp->setValue($kirby, $extensions);
}

Kirby::plugin('thomhines/kirby-revisions', [
	'options' => [
		'enabled'        => true,
		'max'            => 200,
		// When true, the Revisions drawer shows a Delete control per revision (with confirmation).
		'allowDelete'    => true,
	],
	'hooks' => [
		'system.loadPlugins:after' => function () {
			thomhines_kirby_revisions_apply_view_buttons(App::instance());
		},
		'route:after' => function ($route, $path, $method, $result, $final) {
			if ($final !== true) {
				return $result;
			}

			$kirby = App::instance();

			if ($kirby->option('thomhines.kirby-revisions.enabled', true) !== true) {
				return $result;
			}

			if ($method !== 'POST') {
				return $result;
			}

			$inner = thomhines_kirby_revisions_api_inner_path($kirby, $path);

			if (Str::endsWith($inner, '/changes/publish') !== true) {
				return $result;
			}

			if (($result instanceof Response) !== true) {
				return $result;
			}

			// Guard flag used by drawer-triggered "Save revision" to avoid duplicate snapshots.
			$hNoSnap = $kirby->request()->header('X-Revisions-No-Snapshot');

			if ($hNoSnap === '1' || strtolower((string)$hNoSnap) === 'true') {
				return $result;
			}

			$body = $result->body();

			if (is_string($body) !== true || $body === '') {
				return $result;
			}

			$data = json_decode($body, true);

			if (is_array($data) !== true) {
				return $result;
			}

			$status = array_key_exists('status', $data) === true ? $data['status'] : null;

			if ($status !== 'ok') {
				return $result;
			}

			// Only create revisions when JS marks the publish request explicitly.
			$h = $kirby->request()->header('X-Revisions-Snapshot');

			if ($h !== '1' && strtolower((string)$h) !== 'true') {
				return $result;
			}

			$base = Str::before($inner, '/changes/publish');

			try {
				// Publish snapshots copy current model files (not _changes) to support publish-only flow.
				if (Str::startsWith($base, 'pages/') === true) {
					// Match Find::page(): API uses + or space for nested ids (e.g. essays+my-essay).
					$pageId = str_replace(
						['+', ' '],
						'/',
						Str::after($base, 'pages/')
					);
					$page = $kirby->page($pageId);

					if ($page !== null) {
						RevisionsService::snapshotCurrent($page);
					}
				} elseif ($base === 'site') {
					RevisionsService::snapshotCurrent($kirby->site());
				}
			} catch (\Throwable $e) {
				// never break the save response
			}

			return $result;
		},
	],
	'api' => [
		'routes' => function (App $kirby) {
			return [
				[
					'pattern' => 'pages/(:any)/revisions',
					'method'  => 'GET',
					'action'  => function (string $id) use ($kirby) {
						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return [
							'status'    => 'ok',
							'revisions' => RevisionsService::list($page),
						];
					},
				],
				[
					'pattern' => 'pages/(:any)/revisions/snapshot',
					'method'  => 'POST',
					'action'  => function (string $id) use ($kirby) {
						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						$revisionId = RevisionsService::snapshot($page);

						if ($revisionId === null) {
							$revisionId = RevisionsService::snapshotCurrent($page);
						}

						if ($revisionId === null) {
							throw new InvalidArgumentException(
								message: 'No draft on disk to store yet. Save once or wait for autosave, then try again.',
							);
						}

						return [
							'status'       => 'ok',
							'revisionId' => $revisionId,
						];
					},
				],
				[
					'pattern' => 'pages/(:any)/revisions/(:any)/load',
					'method'  => 'POST',
					'action'  => function (string $id, string $revisionId) use ($kirby) {
						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						RevisionsService::load($page, $revisionId);

						return [
							'status' => 'ok',
						];
					},
				],
				[
					'pattern' => 'pages/(:any)/revisions/(:any)',
					'method'  => 'DELETE',
					'action'  => function (string $id, string $revisionId) use ($kirby) {
						if ($kirby->option('thomhines.kirby-revisions.allowDelete', false) !== true) {
							throw new InvalidArgumentException(
								message: 'Revision delete is not enabled',
							);
						}

						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						RevisionsService::delete($page, $revisionId);

						return [
							'status' => 'ok',
						];
					},
				],
				[
					'pattern' => 'pages/(:any)/revisions/(:any)/rename',
					'method'  => 'POST',
					'action'  => function (string $id, string $revisionId) use ($kirby) {
						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						$name = $kirby->request()->get('name');
						RevisionsService::rename($page, $revisionId, is_string($name) === true ? $name : null);

						return [
							'status' => 'ok',
						];
					},
				],
				[
					'pattern' => 'site/revisions',
					'method'  => 'GET',
					'action'  => function () use ($kirby) {
						$site = $kirby->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return [
							'status'    => 'ok',
							'revisions' => RevisionsService::list($site),
						];
					},
				],
				[
					'pattern' => 'site/revisions/snapshot',
					'method'  => 'POST',
					'action'  => function () use ($kirby) {
						$site = $kirby->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						$revisionId = RevisionsService::snapshot($site);

						if ($revisionId === null) {
							$revisionId = RevisionsService::snapshotCurrent($site);
						}

						if ($revisionId === null) {
							throw new InvalidArgumentException(
								message: 'No draft on disk to store yet. Save once or wait for autosave, then try again.',
							);
						}

						return [
							'status'       => 'ok',
							'revisionId' => $revisionId,
						];
					},
				],
				[
					'pattern' => 'site/revisions/(:any)/load',
					'method'  => 'POST',
					'action'  => function (string $revisionId) use ($kirby) {
						$site = $kirby->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						RevisionsService::load($site, $revisionId);

						return [
							'status' => 'ok',
						];
					},
				],
				[
					'pattern' => 'site/revisions/(:any)',
					'method'  => 'DELETE',
					'action'  => function (string $revisionId) use ($kirby) {
						if ($kirby->option('thomhines.kirby-revisions.allowDelete', false) !== true) {
							throw new InvalidArgumentException(
								message: 'Revision delete is not enabled',
							);
						}

						$site = $kirby->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						RevisionsService::delete($site, $revisionId);

						return [
							'status' => 'ok',
						];
					},
				],
				[
					'pattern' => 'site/revisions/(:any)/rename',
					'method'  => 'POST',
					'action'  => function (string $revisionId) use ($kirby) {
						$site = $kirby->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						$name = $kirby->request()->get('name');
						RevisionsService::rename($site, $revisionId, is_string($name) === true ? $name : null);

						return [
							'status' => 'ok',
						];
					},
				],
			];
		},
	],
	'areas' => [
		'site' => [
			'buttons' => [
				'page.revisions' => fn ($page) => new RevisionsViewButton($page),
				'site.revisions' => fn ($site) => new RevisionsViewButton($site),
			],
			'drawers' => [
				'page.revisions' => [
					'pattern' => 'pages/(:any)/revisions',
					'load'    => function (string $id) {
						$page  = Find::page($id);
						$kirby = App::instance();

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return [
							'component' => 'k-revisions-drawer',
							'props'     => [
								'icon'         => 'layers',
								'title'        => 'Revisions',
								'revisions'    => RevisionsService::list($page),
								'apiUrl'       => $kirby->url('api') . '/pages/' . $id . '/revisions',
								'snapshotPath' => 'pages/' . $id . '/revisions/snapshot',
								'csrf'         => $kirby->auth()->csrfFromSession(),
								'allowDelete'  => $kirby->option('thomhines.kirby-revisions.allowDelete', false) === true,
							],
						];
					},
					// Required: closing the drawer POSTs here; without this, Kirby returns "The submit handler is missing".
					'submit'  => function (string $id) {
						$page = Find::page($id);

						if ($page->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return true;
					},
				],
				'site.revisions' => [
					'pattern' => 'site/revisions',
					'load'    => function () {
						$site  = App::instance()->site();
						$kirby = App::instance();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return [
							'component' => 'k-revisions-drawer',
							'props'     => [
								'icon'         => 'layers',
								'title'        => 'Revisions',
								'revisions'    => RevisionsService::list($site),
								'apiUrl'       => $kirby->url('api') . '/site/revisions',
								'snapshotPath' => 'site/revisions/snapshot',
								'csrf'         => $kirby->auth()->csrfFromSession(),
								'allowDelete'  => $kirby->option('thomhines.kirby-revisions.allowDelete', false) === true,
							],
						];
					},
					'submit'  => function () {
						$site = App::instance()->site();

						if ($site->permissions()->cannot('update') === true) {
							throw new PermissionException(
								key: 'version.save.permission',
							);
						}

						return true;
					},
				],
			],
		],
	],
]);

/**
 * Strip language prefix and API slug from the request path.
 */
function thomhines_kirby_revisions_api_inner_path(App $kirby, mixed $path): string
{
	$path = ltrim((string)$path, '/');
	$apiSlug = $kirby->option('api.slug', 'api');

	if ($kirby->multilang() === true) {
		foreach ($kirby->languages()->codes() as $code) {
			$prefix = $code . '/' . $apiSlug . '/';

			if (Str::startsWith($path, $prefix) === true) {
				return Str::afterStart($path, $prefix);
			}
		}
	}

	$prefix = $apiSlug . '/';

	if (Str::startsWith($path, $prefix) === true) {
		return Str::afterStart($path, $prefix);
	}

	return $path;
}

// thomhines/kirby-revisions: after Panel POST …/changes/publish (with X-Revisions-Snapshot), copies current model files into _versions/{id}.
// Toolbar: system.loadPlugins:after merges panel.viewButtons (page + site).
// Options: thomhines.kirby-revisions.enabled, .max, .allowDelete (Panel index.js sets the snapshot header; allowDelete enables per-revision delete in the drawer).
