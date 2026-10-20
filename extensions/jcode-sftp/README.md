# JCode Remote SSH/SFTP

Open remote folders over SSH and SFTP in the regular Explorer. A connection becomes a virtual workspace folder on the `jcode-sftp` file system, so browsing, editing, and saving work like they do for local folders.

This is a virtual workspace backed by SFTP. It does not run terminals, Git, search indexes, or language servers on the remote host. Those can be added as separate services without changing the workspace URI or file operation interface. Moving files between two different connections is not supported. A window whose folders are all on JCode SFTP connections also gets a workspace color of its own automatically; see the `workbench.workspaceColor.autoRemote` setting.

## Connections

Open the **Remote** view in the Activity Bar, or run **JCode Remote: Manage SSH/SFTP Connections...** from the Command Palette. Use the view's **New Connection...** action to enter all connection details in one form: a name (optional), host, port, user, jump hosts (optional), the remote folder (an absolute path), and the authentication method. Choose **Save and Connect** to open the remote workspace immediately, or **Save** to keep it for later.

The row actions of a saved connection open or edit it, and its context menu has **Delete Connection**. A connection that is open in the window cannot be deleted until you switch to another workspace.

### Workspace Folders

Click a saved connection to open its folder in the Explorer. Opening a connection never closes local folders unexpectedly:

- In a window without folders, the connection becomes the only folder.
- When other folders are open, JCode asks whether to **Add to Workspace** (the default), **Open in New Window**, or **Replace Workspace**.
- A connection that is open in the window already is updated in place, for example after you change its remote folder, and a connection that is open unchanged just shows the Explorer.

Opening, saving, creating, renaming, and deleting use SFTP directly; a successful save has already reached the server.

### Authentication and Host Keys

Choose **Password**, **Private Key**, or **SSH Agent** for each connection. A private key is read from the local path you enter (`~/` is expanded), and its passphrase is optional. The agent method needs `SSH_AUTH_SOCK` to be set.

Password and private key passphrase values are stored in VS Code SecretStorage. A password or passphrase you type when connecting is saved only after the server accepts it, so a mistyped one is never stored. If the server refuses a saved password or passphrase, JCode clears it and asks again, up to three times. Connection details are stored in extension global state.

The server's SHA256 host key fingerprint must be trusted on first connection: choose **Trust Once** or **Trust and Remember**. A remembered fingerprint is checked on later connections, and a changed key is refused until you confirm it. Verify the fingerprint with the server administrator before trusting it. A connection attempt times out after 20 seconds, and that limit does not run while the host key prompt is open. Once connected, JCode sends a keepalive every 10 seconds and treats the connection as dropped after three go unanswered.

### Jump Hosts

A connection can reach its server through one or more jump hosts, like OpenSSH's `ProxyJump` or `ssh -J`. Enter them in the **Jump Hosts** field of the connection form as `[user@]host[:port]`, separated by commas, for example `bastion.example.com, deploy@gateway.internal:2200`. The `ssh://user@host:port` form and IPv6 addresses in square brackets (`[::1]:22`) are accepted, up to 8 jump hosts are allowed, and an empty field or `none` means a direct connection. The form checks the field and shows what is wrong with it.

JCode connects to the first jump host directly, opens a channel through it to the next one (SSH `direct-tcpip`, ssh2's `forwardOut`), and so on, and reaches the server through the last one. Every hop goes through the same sign-in and host key verification as a direct connection: the first time JCode connects to a jump host it asks you to trust its fingerprint, which is remembered for that `host:port` like the server's own, and a changed key is refused until you confirm it. A jump host without a user is signed in to as the user of the connection.

Jump hosts use the connection's authentication method and saved credential: **SSH Agent** and **Private Key** offer the same agent or key at every hop, and **Password** sends the connection's password to every hop, so use an agent or a key when a jump host has other credentials. A jump host that refuses the credentials is named in the error, and the saved password is kept then, because it may be right for the server. The 20 second handshake limit applies to each hop and does not run while a host key prompt is open. Closing or dropping the connection closes every hop. The connection's tooltip in the Remote view shows its route (**Via**), and exports carry it as a `proxyJump` string.

### Importing from an SSH Config

To start from the servers you already use with `ssh`, choose **Import Connections from SSH Config...** (the button in the Remote view's title bar, the link shown while there are no connections, or the Command Palette). JCode reads `~/.ssh/config`, shows its hosts in a multi-select list, and creates a connection for each host you tick. Hosts that are already connections (same name, host, user, and port) are left out.

The reader follows OpenSSH's rules:

- Keywords are case-insensitive and may be followed by `=`; quotes, escapes, and `#` comments work as in `ssh`; and the first value found for a setting wins.
- `Include` directives (relative to `~/.ssh`, `~` expanded, with `*` and `?` wildcards, nested up to 16 levels) are read where they appear.
- A `Host` line contributes one host per name it lists. Names with wildcards (such as `Host *`) are not listed, but their settings still apply to the hosts they match, and `!` patterns exclude hosts.
- `Match` blocks are skipped, because their conditions cannot be evaluated without connecting.

From each host JCode takes `HostName` (the name itself when missing, with `%h` expanded), `User` (your local user name when missing), `Port`, and the first `IdentityFile` (`~` and the `%d`, `%u`, `%r`, `%h`, `%n`, and `%p` tokens expanded). A host with an `IdentityFile` uses **Private Key** authentication, otherwise **SSH Agent** when `SSH_AUTH_SOCK` is set and **Password** when it is not. The remote folder starts as `/`; edit the connection to choose another. Nothing secret is read: passwords and key passphrases are never imported, and JCode asks for them when you connect.

A `ProxyJump` becomes the connection's jump hosts. Each jump host is spelled out with the user, host name, and port that `ssh` would use for it, names defined in the config are resolved (`ProxyJump bastion` becomes `admin@bastion.example.com:2200` when the `bastion` block says so), and the jump hosts of a jump host come first. Hosts that use `ProxyCommand`, or a `ProxyJump` that cannot be read or loops back, are flagged in the list because that cannot be reproduced.

### Exporting and Importing Connections

Use **Export Connections to JSON...** and **Import Connections from JSON...** in the Remote view's `...` menu to move connection profiles between JCode installations. When connections have saved passwords or private key passphrases, Export asks how to handle them before anything is written:

- **Encrypt with Passphrase** (the recommended choice) encrypts the credentials with AES-256-GCM using a key derived from your passphrase with scrypt. The passphrase needs at least 8 characters and is asked for twice. Import asks for the passphrase to restore the credentials to SecretStorage without asking for another password. The passphrase cannot be recovered, so keep it safe.
- **Exclude Secrets** exports connection details only, without a `credential` field. Enter passwords again after importing.
- **Include Unencrypted** writes the credentials in a form anyone can decode, and requires confirming a warning first. Plaintext credentials are never written without that confirmation.

The unencrypted format is a version 3 file with each credential encoded as base64:

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
			"proxyJump": "bastion.example.com",
			"credential": "c2VjcmV0"
		}
	]
}
```

Version 1 exports without credentials remain importable, and version 2 is the encrypted format, which requires its passphrase to import. The authentication value can be `password`, `privateKey`, or `agent`; a `privateKey` connection also has a `privateKeyPath`. Private key files themselves are not included, so a usable key must exist at the configured path on the destination computer. Trusted SSH host keys are also not exported; the destination installation asks you to verify the server's fingerprint on first connection.

Import skips connections that are already saved with the same details. When the file holds a credential for such a connection, the credential is restored to it. A file can hold at most 500 connections.

## Connection Status

A status bar item shows the state of the connections used by the open folders: connected, connecting, reconnecting after a dropped connection, or offline. With several connections it summarizes them by the state of the one needing the most attention. The background is a warning color while it is reconnecting or offline, and an error color when it is offline because the last attempt failed. The item's tooltip lists each connection with its state, and for an offline one the reason the last attempt failed and the time of the next retry. Window progress also appears while JCode connects.

Select the item to open its menu. When a connection failed, the menu starts with the reason and **Retry** and **Edit Connection** actions. When a saved password or passphrase is missing or was refused, the menu offers **Enter Password** or **Enter Passphrase** instead, and change detection stops retrying until you enter it or edit the connection. Below those the menu always has **Reconnect**, **Disconnect**, and **Manage Connections**, and it asks which connection to use when several are open.

A failure lives in the status bar item rather than in a notification, because an extension cannot close a notification when a later attempt succeeds and a stale "Could not connect" message would stay on screen. When the connection succeeds, the item simply returns to normal. Only an attempt you started (opening a connection, **Reconnect**, **Save and Connect**) that fails is also reported in a dialog with the same actions, which you answer before anything else changes. Retries in the background never raise notifications.

The Command Palette has **JCode Remote: Reconnect SSH/SFTP Workspace** and **JCode Remote: Disconnect SSH/SFTP Workspace**. Disconnect keeps the connection closed, and change detection does not reopen it, until a file operation needs it again.

## Reconnecting and Change Detection

The provider reconnects after a dropped connection. Reconnecting or editing a connection cancels its pending connection attempt.

While a server is down, change detection does not reconnect at every poll. Background attempts back off exponentially and retry quietly, so the status bar item stays **Offline** instead of flickering between **Reconnecting** and **Offline**. The wait after the first failure is between 5 and 10 seconds, the longest wait doubles with every further failure up to 5 minutes, and each wait is a random point between half of that and all of it, so clients that lost the same server do not all come back together. A **Reconnect**, **Save and Connect**, or any file operation you start tries at once and starts the delay over, and so does a successful connection.

Remote changes are detected by polling only what active watch requests cover: a non-recursive watch lists its own folder, and a recursive watch (such as the workspace folder) sweeps its tree. Polling honors `files.watcherExclude` and skips excluded directories before scanning their contents. A sweep reads at most about 2,000 entries per poll and continues on the next one, so a large tree is spread over several polls and changes are reported as each folder is read. Overlapping watch requests share the folder listings read during a poll. Folders that cannot be read are skipped instead of stopping change detection. Symbolic links retain their target's file or directory type. Recursive polling does not follow directory links to avoid cycles; directly watched linked directories are polled normally.

Two settings control it, and changes to either apply immediately without reconnecting:

```json
{
	"jcodeSftp.pollInterval": 10000,
	"jcodeSftp.pollMaxEntries": 5000
}
```

`jcodeSftp.pollInterval` is the interval in milliseconds (10 seconds by default, at least 1000). Each watched tree tracks at most `jcodeSftp.pollMaxEntries` entries (5,000 by default, at least 100). A folder that would exceed that is skipped while the rest keeps being polled, JCode shows a one-time warning with an **Open Settings** action, and the output channel names each skipped folder. Exclude large folders with `files.watcherExclude` or raise the limit; a folder that was skipped is then recorded quietly at its next poll, so its existing files are not reported as newly created.

## Saving Files

Saves upload to a unique sibling file (`.jcode-sftp-*.tmp`) before replacing the destination. Existing file write permissions are checked, and the mode is preserved; saving through a symbolic link updates its target without replacing the link. The original owner and group are restored only where the connected user can do so (as root, or as the file's owner restoring a group), and failures while restoring the mode are logged in the **JCode Remote SSH/SFTP** output channel instead of failing the save.

Some saves cannot use a replacement file without changing the file: the directory does not allow creating or renaming files, the file belongs to another user and its owner cannot be restored (for example a group-writable file under `/var/www`), or the file has more than one hard link. JCode then truncates and rewrites the existing file in place, which keeps its owner, mode, ACLs, and hard links but is not atomic, so a dropped connection mid-save can leave the file incomplete.

SFTP does not report hard link counts, so JCode asks the server for it with `stat` over the same SSH connection. The count of a file is remembered for 15 seconds, so saving it repeatedly runs one command, and it is forgotten when JCode deletes or renames the file or change detection sees it change. A save itself never changes the count. A server that refuses commands, or answers like one that is not POSIX (for example Windows OpenSSH running `cmd.exe`, which exits cleanly without printing a count), is detected once per connection: JCode stops asking it, the output channel says why, and files are assumed to have a single link, so they are saved through the staged replacement.

Servers supporting OpenSSH's POSIX rename extension replace existing files atomically. Other servers use a backup-and-restore fallback for saves and overwrite-renames. The destination can briefly be absent during this fallback. If a connection failure prevents restoration, the error identifies the `.jcode-sftp-*.bak` file containing the original. Restore it after reconnecting. Incomplete `.jcode-sftp-*.tmp` uploads and backups that cannot be cleaned up are reported in the output channel.

## Running the Tests

The unit tests use Node's built-in test runner and run in plain Node, without an extension host. From `extensions/jcode-sftp` run:

```sh
npm test
```

This removes the compiled tests in `out/test`, so a renamed or deleted test cannot linger, compiles the extension with the repository's TypeScript compiler (`npm run compile`, which calls `node ../../node_modules/@typescript/native/bin/tsc`, the same entry point the repository build uses) and then runs `node --test "out/test/**/*.test.js"`. The tests replace the `vscode` module with the small stand-in in `src/test/vscodeStub.ts` and talk to fake SSH clients, so they never open a network connection. After compiling once, run a single file with `node --test out/test/treePoller.test.js`. Use the Node.js version in the repository's `.nvmrc`, since the stub relies on `module.registerHooks`.
