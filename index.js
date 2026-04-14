/**
 * Kirby’s editor mostly persists drafts through throttled autosave, not through
 * the public content.save() entry point. If this is false, revisions are only
 * created when something calls content.save / content.update (e.g. some field
 * uploads). Set false to only snapshot on those explicit saves (rare while
 * editing body text in the default Panel). The default true snapshots after
 * each autosave idle (trailing edge of the 1s throttle), not on every keystroke.
 */
const REVISIONS_TRAILING_SNAPSHOTS = true;

/**
 * Kirby-compatible throttle, but the callback receives a leading boolean:
 * `true` when invoked from the trailing timer, `false` when from the leading call.
 * Used to send a revision snapshot header only after autosave idle (trailing),
 * not on the first keystroke (leading).
 */
function revisionsThrottle(callback, delay, options = {}) {
	options = { leading: true, trailing: false, ...options };
	let timer = null;
	let last = null;
	let trailingArgs = null;

	function throttled(...args) {
		if (timer) {
			last = this;
			trailingArgs = args;
			return;
		}

		if (options.leading) {
			callback.call(this, false, ...args);
		} else {
			last = this;
			trailingArgs = args;
		}

		const cooled = () => {
			if (options.trailing && trailingArgs) {
				callback.call(last, true, ...trailingArgs);

				last = null;
				trailingArgs = null;
				timer = setTimeout(cooled, delay);
			} else {
				timer = null;
			}
		};

		timer = setTimeout(cooled, delay);
	}

	throttled.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
			last = null;
			trailingArgs = null;
		}
	};

	return throttled;
}

function revisionsInstallApiPostPatch(panel) {
	const api = panel.api;

	if (api.__revisionsPostPatched === true) {
		return;
	}

	api.__revisionsPostPatched = true;

	if (panel.__revisionsSnapshotSuppress !== true) {
		panel.__revisionsSnapshotSuppress = false;
	}

	const origPost = api.post.bind(api);

	api.post = async (path, data, options, method, silent) => {
		let opts = options;

		if (typeof path === "string" && path.endsWith("/changes/save") === true) {
			const nextHeaders = { ...(options?.headers ?? {}) };

			if (panel.__revisionsSnapshotSuppress === true) {
				nextHeaders["X-Revisions-No-Snapshot"] = "1";
			} else if (panel.__revisionsSnapshotRequest === true) {
				nextHeaders["X-Revisions-Snapshot"] = "1";
			}

			if (
				nextHeaders["X-Revisions-Snapshot"] !== undefined ||
				nextHeaders["X-Revisions-No-Snapshot"] !== undefined
			) {
				opts = { ...(options ?? {}), headers: nextHeaders };
			}
		}

		return origPost(path, data, opts, method, silent);
	};
}

function revisionsInstallContentSavePatch(panel) {
	const content = panel.content;

	if (content.__revisionsContentPatched === true) {
		return;
	}

	content.__revisionsContentPatched = true;

	const coreSave = content.save.bind(content);
	const trailingSnapshots = REVISIONS_TRAILING_SNAPSHOTS === true;

	if (typeof content.saveLazy?.cancel === "function") {
		content.saveLazy.cancel();
	}

	const autosaveSave = async (isTrailing, values, env) => {
		if (isTrailing === true && trailingSnapshots === true) {
			panel.__revisionsSnapshotRequest = true;
		}

		try {
			return await coreSave(values, env);
		} finally {
			panel.__revisionsSnapshotRequest = false;
		}
	};

	content.saveLazy = revisionsThrottle(autosaveSave, 1000, {
		leading: true,
		trailing: true,
		timer: content.timer,
	});

	content.save = async (values = {}, env = {}) => {
		panel.__revisionsSnapshotRequest = true;
		try {
			return await coreSave(values, env);
		} finally {
			panel.__revisionsSnapshotRequest = false;
		}
	};
}

window.panel.plugin("thomhines/kirby-revisions", {
	created(vm) {
		const panel = vm.$panel;

		if (typeof panel?.api?.post === "function") {
			revisionsInstallApiPostPatch(panel);
		}

		if (typeof panel?.content?.save === "function") {
			revisionsInstallContentSavePatch(panel);
		}
	},
	components: {
		"k-revisions-drawer": {
			// Same as core FormDrawer/TextDrawer: Drawer mixin declares visible, current, breadcrumb, title, etc.
			// Without these on k-drawer, its portal stays v-if="visible" false and nothing appears.
			mixins: ["drawer"],
			emits: ["cancel", "crumb", "submit", "tab"],
			props: {
				revisions: {
					type: Array,
					default: () => [],
				},
				apiUrl: {
					type: String,
					default: "",
				},
				snapshotPath: {
					type: String,
					default: "",
				},
				csrf: {
					type: String,
					default: "",
				},
				allowDelete: {
					type: Boolean,
					default: false,
				},
			},
			data() {
				return {
					localRevisions: [],
					savingRevision: false,
				};
			},
			watch: {
				revisions: {
					deep: true,
					immediate: true,
					handler(val) {
						this.localRevisions = Array.isArray(val) ? [...val] : [];
					},
				},
			},
			methods: {
				async refreshRevisionsList() {
					if (typeof this.apiUrl !== "string" || this.apiUrl === "") {
						return;
					}

					try {
						const res = await fetch(this.apiUrl, {
							method: "GET",
							headers: { Accept: "application/json" },
							credentials: "same-origin",
						});
						const json = await res.json().catch(() => ({}));

						if (
							res.ok === true &&
							Array.isArray(json.revisions) === true
						) {
							this.localRevisions = [...json.revisions];
						}
					} catch {
						// list refresh is optional after save
					}
				},
				async saveRevisionSnapshot() {
					if (
						this.savingRevision === true ||
						typeof this.snapshotPath !== "string" ||
						this.snapshotPath === ""
					) {
						return;
					}

					const panel = this.$panel;

					this.savingRevision = true;

					try {
						if (typeof panel?.content?.save === "function") {
							panel.__revisionsSnapshotSuppress = true;

							try {
								await panel.content.save({}, { silent: true });
							} finally {
								panel.__revisionsSnapshotSuppress = false;
							}
						}

						const json = await panel.api.post(this.snapshotPath, {});

						if (json?.status === "ok") {
							if (typeof panel?.notification?.success === "function") {
								panel.notification.success("Revision saved");
							}

							await this.refreshRevisionsList();
						}
					} catch (err) {
						const msg =
							err?.details?.message ||
							err?.message ||
							"Could not save revision";

						if (typeof panel?.notification?.error === "function") {
							panel.notification.error(msg);
						} else {
							alert(msg);
						}
					} finally {
						this.savingRevision = false;
					}
				},
				async confirmDeleteRevision(revision) {
					const panel = this.$panel;
					const label = revision?.label || revision?.id || "";

					const runDelete = async () => {
						try {
							await this.deleteRevision(revision.id);
							if (typeof panel?.notification?.success === "function") {
								panel.notification.success("Revision deleted");
							}
						} catch {
							// deleteRevision already reported the error
						} finally {
							if (typeof panel?.dialog?.close === "function") {
								await panel.dialog.close();
							}
						}
					};

					if (typeof panel?.dialog?.open !== "function") {
						if (
							window.confirm(
								`Permanently delete this revision (${label})? This cannot be undone.`,
							) !== true
						) {
							return;
						}

						await runDelete();
						return;
					}

					await panel.dialog.open({
						component: "k-remove-dialog",
						props: {
							text: `Permanently delete this revision (${label})? This cannot be undone.`,
						},
						on: {
							submit: runDelete,
						},
					});
				},
				async deleteRevision(id) {
					const url =
						this.apiUrl + "/" + encodeURIComponent(id);

					const res = await fetch(url, {
						method: "DELETE",
						headers: {
							Accept: "application/json",
							"X-CSRF": this.csrf,
						},
						credentials: "same-origin",
					});

					const json = await res.json().catch(() => ({}));

					if (
						res.ok !== true ||
						(json.status !== undefined && json.status !== "ok")
					) {
						const msg =
							json.message ||
							json.error ||
							"Could not delete revision";

						if (window.panel?.notification?.error) {
							window.panel.notification.error(msg);
						} else {
							alert(msg);
						}

						throw new Error(msg);
					}

					this.localRevisions = this.localRevisions.filter(
						(r) => r.id !== id,
					);
				},
				async loadRevision(id) {
					const url =
						this.apiUrl +
						"/" +
						encodeURIComponent(id) +
						"/load";

					try {
						const res = await fetch(url, {
							method: "POST",
							headers: {
								Accept: "application/json",
								"Content-Type": "application/json",
								"X-CSRF": this.csrf,
							},
							credentials: "same-origin",
							body: "{}",
						});

						const json = await res.json().catch(() => ({}));

						if (
							res.ok !== true ||
							(json.status !== undefined && json.status !== "ok")
						) {
							const msg =
								json.message ||
								json.error ||
								"Could not load revision";
							if (window.panel?.notification?.error) {
								window.panel.notification.error(msg);
							} else {
								alert(msg);
							}
							return;
						}

						if (typeof this.$reload === "function") {
							await this.$reload();
							return;
						}

						window.location.reload();
					} catch (err) {
						const msg = String(err?.message || err);
						if (window.panel?.notification?.error) {
							window.panel.notification.error(msg);
						} else {
							alert(msg);
						}
					}
				},
			},
			template: `
				<k-drawer
					ref="drawer"
					class="k-revisions-drawer"
					v-bind="$props"
					@cancel="$emit('cancel')"
					@crumb="$emit('crumb', $event)"
					@submit="$emit('submit')"
					@tab="$emit('tab', $event)"
				>
					<div class="k-revisions-drawer-body k-p-6">
						<div
							v-if="snapshotPath !== ''"
							class="k-revisions-drawer-save k-mb-6"
						>
							<k-text
								class="k-mb-3"
								theme="help"
							>
								<h6>Save revision</h6>
								Saves a snapshot of your current draft. Published (live) content is not changed.
							</k-text>
							<k-button
								icon="check"
								size="sm"
								variant="filled"
								:disabled="savingRevision"
								:loading="savingRevision"
								@click="saveRevisionSnapshot"
							>
								Save revision
							</k-button>
						</div>
						<br><br>
						<k-text class="k-mb-4" theme="help">
							<h6>Revisions</h6>
							Loading a revision overwrites your current draft in the Panel with that snapshot.
						</k-text>
						<k-text
							v-if="localRevisions.length === 0"
							class="k-mb-6"
							theme="help"
						>
							<p>No revisions yet</p>
							<p>Edit the page and wait for a save or autosave to see the first entry.</p>
						</k-text>
						<div
							v-else
							class="k-revisions-table"
						>
							<div
								v-for="r in localRevisions"
								:key="r.id"
								class="k-revisions-table-row"
							>
								<span class="k-revisions-table-row-label">{{ r.label }}</span>
								<div class="k-revisions-table-row-actions">
									<k-button
										icon="check"
										size="sm"
										variant="filled"
										@click="loadRevision(r.id)"
									>
										Load
									</k-button>
									<k-button
										v-if="allowDelete"
										icon="trash"
										size="sm"
										theme="negative"
										variant="filled"
										@click="confirmDeleteRevision(r)"
									>
										
									</k-button>
								</div>
							</div>
						</div>
					</div>
				</k-drawer>
			`,
		},
	},
});
