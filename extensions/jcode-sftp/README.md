# JCode Remote SSH/SFTP

Open the **Remote** view in the Activity Bar, or run **JCode Remote: Manage SSH/SFTP Connections...** from the Command Palette. Use the view's **New Connection** action to enter all connection details in one form. Choose **Save and Connect** to open the remote workspace immediately, or **Save** to keep it for later. Click a saved connection to switch the current window to its workspace. The row actions and context menu let you edit or delete it. JCode opens the selected folder in the regular Explorer. Opening, saving, creating, renaming, and deleting use SFTP directly; a successful save has already reached the server.

Use **Export** and **Import** in the Remote view's menu to move connection profiles between JCode installations. The JSON file includes any saved passwords and private key passphrases. Import restores them to JCode's SecretStorage without asking for another password. Anyone with the export file can recover its credentials, so store and share it accordingly. The format is:

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

Version 1 exports without credentials and version 2 encrypted exports remain importable. Importing a version 2 export still requires its passphrase. The authentication value can be `password`, `privateKey`, or `agent`. Private key files themselves are not included, so a usable key must exist at the configured path on the destination computer. Trusted SSH host keys are also not exported; the destination installation asks you to verify the server's fingerprint on first connection.

Password and private key passphrase values are stored in VS Code SecretStorage. Connection details are stored in extension global state. The server's SHA256 host key fingerprint must be accepted on first connection and is checked on later connections if remembered. Verify the fingerprint with the server administrator before trusting it.

Saves upload to a unique sibling file before replacing the destination. Existing file write permissions are checked, and ownership and mode are preserved; saving through a symbolic link updates its target without replacing the link. This requires permission to create and rename files in the destination directory and to preserve the original ownership. Replacement creates a new file, so hard links and server-specific ACLs are not preserved.

Servers supporting OpenSSH's POSIX rename extension replace existing files atomically. Other servers use a backup-and-restore fallback for saves and overwrite-renames. The destination can briefly be absent during this fallback. If a connection failure prevents restoration, the error identifies the `.jcode-sftp-*.bak` file containing the original. Restore it after reconnecting. Incomplete `.jcode-sftp-*.tmp` uploads and backups that cannot be cleaned up are reported in the output channel.

The provider reconnects after a dropped connection. Run **JCode Remote: Reconnect SSH/SFTP Workspace** to reconnect manually. Reconnecting or editing a connection cancels its pending connection attempt. Remote changes are detected by polling watched paths; `jcodeSftp.pollInterval` controls the interval (10 seconds by default). Polling honors `files.watcherExclude` and skips excluded directories before scanning their contents. Polling is capped at 5,000 included entries per watched tree to avoid unbounded scans. A large tree exceeding that cap logs a warning and is not polled until its included entry count falls below the cap. Symbolic links retain their target's file or directory type. Recursive polling does not follow directory links to avoid cycles; directly watched linked directories are polled normally.

This is a virtual workspace backed by SFTP. It does not run terminals, Git, search indexes, or language servers on the remote host. Those can be added as separate services without changing the workspace URI or file operation interface.
