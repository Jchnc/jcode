# JCode Remote SSH/SFTP

Open the **Remote** view in the Activity Bar, or run **JCode Remote: Manage SSH/SFTP Connections...** from the Command Palette. Use the view's **New Connection** action to enter all connection details in one form. Choose **Save and Connect** to open the remote workspace immediately, or **Save** to keep it for later. Click a saved connection to open its folder: in a window without folders it becomes the only folder, and when other folders are open JCode asks whether to **Add to Workspace** (the default), **Open in New Window**, or **Replace Workspace**, so opening a connection never closes local folders unexpectedly. A connection that is already open in the window is updated in place, for example after you change its remote folder. The row actions and context menu let you edit or delete it. JCode opens the selected folder in the regular Explorer. Opening, saving, creating, renaming, and deleting use SFTP directly; a successful save has already reached the server.

Use **Export** and **Import** in the Remote view's menu to move connection profiles between JCode installations. When connections have saved passwords or private key passphrases, Export asks how to handle them before anything is written. **Encrypt with Passphrase** (the default) encrypts the credentials with AES-256-GCM using a key derived from your passphrase with scrypt, and Import asks for the passphrase to restore them to JCode's SecretStorage without asking for another password. **Exclude Secrets** exports connection details only. **Include Unencrypted** writes the credentials in a form anyone can decode and requires confirming a warning first. Plaintext credentials are never written without that confirmation. The unencrypted format is:

```json
{
  "version": 3,
  "connections": [
    {
      "name": "Production server",
      "host": "server.example.com",
      "port": 22,
      "username": "deploy",
      "root": "/srv/app",
      "authentication": "password",
      "credential": "..."
    }
  ]
}
```

Version 1 exports without credentials remain importable, and version 2 is the encrypted format, which requires its passphrase to import. Exports without credentials omit the `credential` field. The authentication value can be `password`, `privateKey`, or `agent`. Private key files themselves are not included, so a usable key must exist at the configured path on the destination computer. Trusted SSH host keys are also not exported; the destination installation asks you to verify the server's fingerprint on first connection.

Password and private key passphrase values are stored in VS Code SecretStorage. A password or passphrase you type when connecting is saved only after the server accepts it, so a mistyped one is never stored. If the server refuses a saved password or passphrase, JCode clears it and asks again, up to three times. Connection details are stored in extension global state. The server's SHA256 host key fingerprint must be accepted on first connection and is checked on later connections if remembered. Verify the fingerprint with the server administrator before trusting it. The 20 second connection timeout does not run while the host key prompt is open.

Saves upload to a unique sibling file before replacing the destination. Existing file write permissions are checked, and the mode is preserved; saving through a symbolic link updates its target without replacing the link. The original owner and group are restored only where the connected user can do so (as root, or as the file's owner restoring a group), and failures while restoring the mode are logged in the output channel instead of failing the save.

Some saves cannot use a replacement file without changing the file: the directory does not allow creating or renaming files, the file belongs to another user and its owner cannot be restored (for example a group-writable file under `/var/www`), or the file has more than one hard link. JCode then truncates and rewrites the existing file in place, which keeps its owner, mode, ACLs and hard links but is not atomic, so a dropped connection mid-save can leave the file incomplete. SFTP does not report hard link counts, so JCode asks the server for it with `stat` over the same SSH connection. The count of a file is remembered for 15 seconds, so saving it repeatedly runs one command, and it is forgotten when JCode deletes or renames the file or change detection sees it change. A save itself never changes the count. A server that refuses commands, or answers like one that is not POSIX (for example Windows OpenSSH running `cmd.exe`, which exits cleanly without printing a count), is detected once per connection: JCode stops asking it, the output channel says why, and files are assumed to have a single link, so they are saved through the staged replacement.

Servers supporting OpenSSH's POSIX rename extension replace existing files atomically. Other servers use a backup-and-restore fallback for saves and overwrite-renames. The destination can briefly be absent during this fallback. If a connection failure prevents restoration, the error identifies the `.jcode-sftp-*.bak` file containing the original. Restore it after reconnecting. Incomplete `.jcode-sftp-*.tmp` uploads and backups that cannot be cleaned up are reported in the output channel.

A status bar item shows the state of the connections used by the open folders: connected, connecting, reconnecting after a dropped connection, or offline, with a warning background while reconnecting or offline and an error background when the last attempt failed. Click it to **Reconnect**, **Disconnect** or **Manage Connections**. Window progress appears while JCode connects, and a failed connection shows a notification with **Retry** and **Edit Connection** actions. After you dismiss it, background retries stay quiet until the connection succeeds or you reconnect. When a saved password or passphrase is missing or was refused, the notification offers **Enter Password** or **Enter Passphrase** instead, and change detection stops retrying until you enter it or edit the connection. Disconnect keeps the connection closed, and change detection does not reopen it, until a file operation needs it again.

The provider reconnects after a dropped connection. Run **JCode Remote: Reconnect SSH/SFTP Workspace** to reconnect manually. Reconnecting or editing a connection cancels its pending connection attempt. While a server is down, change detection does not reconnect at every poll: background attempts back off exponentially (about 10 seconds after the first failure, doubling up to 5 minutes, with random jitter) and retry quietly, so the status bar item stays **Offline** instead of flickering between **Reconnecting** and **Offline**, and its tooltip shows the time of the next retry. A **Reconnect**, **Save and Connect**, or any file operation you start tries at once and starts the delay over, and so does a successful connection. Remote changes are detected by polling only what active watch requests cover: a non-recursive watch lists its own folder, and a recursive watch (such as the workspace folder) sweeps its tree. `jcodeSftp.pollInterval` controls the interval (10 seconds by default) and changes apply immediately without reconnecting. Polling honors `files.watcherExclude` and skips excluded directories before scanning their contents. A sweep reads at most about 2,000 entries per poll and continues on the next one, so a large tree is spread over several polls and changes are reported as each folder is read. Overlapping watch requests share the folder listings read during a poll. Each watched tree tracks at most `jcodeSftp.pollMaxEntries` entries (5,000 by default); a folder that would exceed that is skipped while the rest keeps being polled, JCode shows a one-time warning with an **Open Settings** action, and the output channel names each skipped folder. Exclude large folders with `files.watcherExclude` or raise the limit; the change applies immediately, and a folder that was skipped is then recorded quietly at its next poll, so its existing files are not reported as newly created. Folders that cannot be read are skipped instead of stopping change detection. Symbolic links retain their target's file or directory type. Recursive polling does not follow directory links to avoid cycles; directly watched linked directories are polled normally.

This is a virtual workspace backed by SFTP. It does not run terminals, Git, search indexes, or language servers on the remote host. Those can be added as separate services without changing the workspace URI or file operation interface.

## Running the Tests

The unit tests use Node's built-in test runner and run in plain Node, without an extension host. From `extensions/jcode-sftp` run:

```sh
npm test
```

This removes the compiled tests in `out/test`, so a renamed or deleted test cannot linger, compiles the extension with the repository's TypeScript compiler (`npm run compile`, which calls `node ../../node_modules/@typescript/native/bin/tsc`, the same entry point the repository build uses) and then runs `node --test "out/test/**/*.test.js"`. The tests replace the `vscode` module with the small stand-in in `src/test/vscodeStub.ts` and talk to fake SSH clients, so they never open a network connection. After compiling once, run a single file with `node --test out/test/treePoller.test.js`. Use the Node.js version in the repository's `.nvmrc`, since the stub relies on `module.registerHooks`.
