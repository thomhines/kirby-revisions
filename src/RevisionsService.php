<?php

namespace Thomhines\KirbyRevisions;

use DateTimeImmutable;
use DateTimeZone;
use Kirby\Cms\App;
use Kirby\Cms\ModelWithContent;
use Kirby\Content\VersionCache;
use Kirby\Content\VersionId;
use Kirby\Exception\NotFoundException;
use Kirby\Filesystem\Dir;
use Kirby\Filesystem\F;
use Kirby\Toolkit\Str;

/**
 * Filesystem snapshots of Panel `_changes` under `_versions/{revisionId}`.
 */
class RevisionsService
{
	public static function changesPath(ModelWithContent $model): string
	{
		return $model->root() . '/_changes';
	}

	public static function versionsPath(ModelWithContent $model): string
	{
		return $model->root() . '/_versions';
	}

	/**
	 * New revision folder id: sortable, filesystem-safe (no colons).
	 */
	public static function newRevisionId(): string
	{
		return gmdate('Y-m-d\THis') . 'Z-' . Str::lower(Str::random(6));
	}

	/**
	 * Copy all files from `_changes` into `_versions/{id}`. Returns null if nothing to store.
	 */
	public static function snapshot(ModelWithContent $model): string|null
	{
		$changes = static::changesPath($model);

		if (Dir::exists($changes) !== true || Dir::isEmpty($changes) === true) {
			return null;
		}

		$id       = static::newRevisionId();
		$target   = static::versionsPath($model) . '/' . $id;

		if (Dir::make($target) !== true) {
			return null;
		}

		foreach (Dir::read($changes) as $name) {
			$src = $changes . '/' . $name;

			if (is_file($src) !== true) {
				continue;
			}

			F::copy($src, $target . '/' . $name);
		}

		static::prune($model);

		return $id;
	}

	/**
	 * @return array<int, array{id: string, label: string, mtime: int}>
	 */
	public static function list(ModelWithContent $model): array
	{
		$root = static::versionsPath($model);

		if (Dir::exists($root) !== true) {
			return [];
		}

		$items = [];

		foreach (Dir::read($root) as $name) {
			if (static::isValidRevisionId($name) !== true) {
				continue;
			}

			$dir = $root . '/' . $name;

			if (is_dir($dir) !== true) {
				continue;
			}

			$mtime = filemtime($dir) ?: 0;
			$items[] = [
				'id'    => $name,
				'label' => static::formatRevisionLabel($mtime),
				'mtime' => $mtime,
			];
		}

		usort($items, fn ($a, $b) => $b['mtime'] <=> $a['mtime']);

		return array_values($items);
	}

	/**
	 * Human-friendly date/time in the PHP default timezone (server local).
	 */
	public static function formatRevisionLabel(int $timestamp): string
	{
		if ($timestamp < 1) {
			return '';
		}

		$tz = new DateTimeZone(date_default_timezone_get());
		$dt = (new DateTimeImmutable('@' . $timestamp))->setTimezone($tz);

		return $dt->format('M j, Y — g:i A');
	}

	public static function load(ModelWithContent $model, string $revisionId): void
	{
		if (static::isValidRevisionId($revisionId) !== true) {
			throw new NotFoundException(message: 'Invalid revision id');
		}

		$src = static::versionsPath($model) . '/' . $revisionId;

		if (Dir::exists($src) !== true) {
			throw new NotFoundException(message: 'Revision not found');
		}

		$changes = static::changesPath($model);
		Dir::make($changes);

		foreach (Dir::read($changes) as $name) {
			$file = $changes . '/' . $name;

			if (is_file($file) === true) {
				F::unlink($file);
			}
		}

		foreach (Dir::read($src) as $name) {
			$from = $src . '/' . $name;

			if (is_file($from) !== true) {
				continue;
			}

			F::copy($from, $changes . '/' . $name);
		}

		static::flushVersionCache($model);
	}

	/**
	 * Remove a stored revision folder from `_versions`.
	 */
	public static function delete(ModelWithContent $model, string $revisionId): void
	{
		if (static::isValidRevisionId($revisionId) !== true) {
			throw new NotFoundException(message: 'Invalid revision id');
		}

		$dir = static::versionsPath($model) . '/' . $revisionId;

		if (Dir::exists($dir) !== true) {
			throw new NotFoundException(message: 'Revision not found');
		}

		Dir::remove($dir);
	}

	public static function isValidRevisionId(string $id): bool
	{
		return (bool)preg_match('/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]{6}$/', $id);
	}

	protected static function prune(ModelWithContent $model): void
	{
		$max = App::instance()->option('thomhines.kirby-revisions.max', 100);

		if (is_int($max) !== true || $max < 1) {
			return;
		}

		$list = static::list($model);

		if (count($list) <= $max) {
			return;
		}

		$root = static::versionsPath($model);

		foreach (array_slice($list, $max) as $row) {
			Dir::remove($root . '/' . $row['id']);
		}
	}

	protected static function flushVersionCache(ModelWithContent $model): void
	{
		$changes = $model->version(VersionId::changes());

		foreach ($model->kirby()->languages() as $language) {
			VersionCache::remove($changes, $language);
		}
	}
}
