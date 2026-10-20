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

Some saves cannot use a replacement file without changing the file: the directory does not allow creating or renaming files, the file belongs to another user and its owner cannot be restored (for example a group-writable file under `/var/www`), or the file has more than one hard link. JCode then truncates and rewrites the existing file in place, which keeps its owner, mode, ACLs and hard links but is not atomic, so a dropped connection mid-save can leave the file incomplete. SFTP does not report hard link counts, so JCode asks the server for it with `stat` over the same SSH connection. Servers that do not allow commands are detected once per connection, and files are then assumed to have a single link.

Servers supporting OpenSSH's POSIX rename extension replace existing files atomically. Other servers use a backup-and-restore fallback for saves and overwrite-renames. The destination can briefly be absent during this fallback. If a connection failure prevents restoration, the error identifies the `.jcode-sftp-*.bak` file containing the original. Restore it after reconnecting. Incomplete `.jcode-sftp-*.tmp` uploads and backups that cannot be cleaned up are reported in the output channel.

The provider reconnects after a dropped connection. Run **JCode Remote: Reconnect SSH/SFTP Workspace** to reconnect manually. Reconnecting or editing a connection cancels its pending connection attempt. Remote changes are detected by polling only what active watch requests cover: a non-recursive watch lists its own folder, and a recursive watch (such as the workspace folder) sweeps its tree. `jcodeSftp.pollInterval` controls the interval (10 seconds by default) and changes apply immediately without reconnecting. Polling honors `files.watcherExclude` and skips excluded directories before scanning their contents. A sweep reads at most about 2,000 entries per poll and continues on the next one, so a large tree is spread over several polls and changes are reported as each folder is read. Overlapping watch requests share the folder listings read during a poll. Each watched tree tracks at most `jcodeSftp.pollMaxEntries` entries (5,000 by default); a folder that would exceed that is skipped while the rest keeps being polled, JCode shows a one-time warning with an **Open Settings** action, and the output channel names each skipped folder. Exclude large folders with `files.watcherExclude` or raise the limit. Folders that cannot be read are skipped instead of stopping change detection. Symbolic links retain their target's file or directory type. Recursive polling does not follow directory links to avoid cycles; directly watched linked directories are polled normally.

This is a virtual workspace backed by SFTP. It does not run terminals, Git, search indexes, or language servers on the remote host. Those can be added as separate services without changing the workspace URI or file operation interface.
