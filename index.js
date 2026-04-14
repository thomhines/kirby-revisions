// Match publish API calls (manual Save/Publish flow).
function revisionsIsChangesPublishPath(path) {
	if (typeof path !== "string") {
		return false;
	}

	const normalized = path.split("#")[0];

	return /\/changes\/publish(?:$|\?)/.test(normalized);
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

	// Attach revision headers only to publish calls so autosave is ignored.
	api.post = async (path, data, options, method, silent) => {
		let opts = options;
		const isPublishPath = revisionsIsChangesPublishPath(path) === true;
		const isChangesPublish = isPublishPath === true;
		let headerDecision = "none";

		if (isChangesPublish === true) {
			const nextHeaders = { ...(options?.headers ?? {}) };

			// Revisions are tied only to explicit publish requests.
			if (panel.__revisionsSnapshotSuppress === true) {
				nextHeaders["X-Revisions-No-Snapshot"] = "1";
				delete nextHeaders["X-Revisions-Snapshot"];
				headerDecision = "no-snapshot (suppressed)";
			} else if (isPublishPath === true) {
				nextHeaders["X-Revisions-Snapshot"] = "1";
				delete nextHeaders["X-Revisions-No-Snapshot"];
				headerDecision = "snapshot";
			} else {
				nextHeaders["X-Revisions-No-Snapshot"] = "1";
				delete nextHeaders["X-Revisions-Snapshot"];
				headerDecision = "no-snapshot (silent/autosave)";
			}

			if (
				nextHeaders["X-Revisions-Snapshot"] !== undefined ||
				nextHeaders["X-Revisions-No-Snapshot"] !== undefined
			) {
				opts = { ...(options ?? {}), headers: nextHeaders };
			}
		}

		return await origPost(path, data, opts, method, silent);
	};
}

window.panel.plugin("thomhines/kirby-revisions", {
	created(vm) {
		const panel = vm.$panel;

		if (typeof panel?.api?.post === "function") {
			revisionsInstallApiPostPatch(panel);
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
				// Re-fetch from API after mutations so the drawer list stays in sync.
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
						// Persist pending form changes first, but prevent the publish hook snapshot.
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
					// Uses fetch directly because Kirby's panel API helper does not expose DELETE with csrf.
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
							<p>Edit the page and click Save to see the first entry.</p>
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
