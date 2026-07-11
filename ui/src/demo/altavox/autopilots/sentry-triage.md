Run a Sentry triage sweep now.

Pull the recent unresolved Sentry issues via the Sentry MCP and, for each genuine bug that is not already on the board, file a backlog issue. Skip user reports and improvements; skip anything that is not a real defect. Dedup against existing issues by their `sentry_issue_id` metadata, and stamp that key (plus `sentry_permalink`) on anything you create. Leave each new bug in Backlog, but promote it to Todo when it is very high severity or spiking. Finish with a short summary of what you scanned, filed, promoted, and skipped.
