const DEFAULT_TIME = "2026-03-14T16:40:00-04:00";

function directory(children, meta = {}) {
  return {
    type: "directory",
    children,
    mode: meta.mode || "drwxr-xr-x",
    owner: meta.owner || "visitor",
    group: meta.group || "staff",
    mtime: meta.mtime || DEFAULT_TIME
  };
}

function textFile(content, meta = {}) {
  const text = Array.isArray(content) ? content.join("\n") : content;

  return {
    type: "file",
    content: text,
    mode: meta.mode || "-rw-r--r--",
    owner: meta.owner || "visitor",
    group: meta.group || "staff",
    mtime: meta.mtime || DEFAULT_TIME,
    mime: meta.mime || "text/plain; charset=utf-8",
    executable: Boolean(meta.executable)
  };
}

const shellConfig = Object.freeze({
  user: "visitor",
  host: "string.cat",
  home: "/home/visitor",
  shell: "/bin/bash",
  term: "xterm-256color",
  os: "Linux",
  kernel: "6.8.12-stringcat",
  arch: "x86_64",
  group: "staff"
});

const bootLines = Object.freeze([
  "string.cat shell",
  "read-only shell for a mostly quiet domain",
  'type "help" or press Tab to explore'
]);

const fileSystem = directory(
  {
    etc: directory(
      {
        motd: textFile(
          [
            "string.cat shell",
            "read-only shell for a mostly quiet domain",
            'type "help" or press Tab to explore'
          ],
          {
            owner: "root",
            group: "wheel",
            mtime: "2026-03-14T16:41:00-04:00"
          }
        ),
        issue: textFile("string.cat shell\n", {
          owner: "root",
          group: "wheel",
          mtime: "2026-03-14T16:40:00-04:00"
        })
      },
      {
        owner: "root",
        group: "wheel",
        mtime: "2026-03-14T16:41:00-04:00"
      }
    ),
    home: directory(
      {
        visitor: directory(
          {
            ".bashrc": textFile(
              [
                'export PS1="\\u@\\h:\\w\\$ "',
                'export PATH="$HOME/bin:/usr/local/bin:/usr/bin:/bin"',
                'alias ll="ls -la"',
                'alias la="ls -a"',
                'alias printenv="env"'
              ],
              {
                mtime: "2026-03-14T16:42:00-04:00"
              }
            ),
            "about.txt": textFile(
              [
                "string.cat is string.cat.",
              ],
              {
                mtime: "2026-03-14T16:43:00-04:00"
              }
            ),
            "services.txt": textFile(
              [
                "email",
                "string.cat hvh cheat releasing 2032"
              ],
              {
                mtime: "2026-03-14T16:43:00-04:00"
              }
            ),
            "contact.txt": textFile(
              [
                "No public mailbox is advertised here.",
                "Mail routing lives on this domain, but the landing page stays quiet."
              ],
              {
                mtime: "2026-03-14T16:44:00-04:00"
              }
            ),
            bin: directory(
              {
                "status.sh": textFile(
                  [
                    "#!/bin/sh",
                    'echo "string.cat is hosted on pages.dev you fat chud."'
                  ],
                  {
                    mode: "-rwxr-xr-x",
                    executable: true,
                    mime: "text/x-shellscript; charset=utf-8",
                    mtime: "2026-03-14T16:45:00-04:00"
                  }
                )
              },
              {
                mtime: "2026-03-14T16:45:00-04:00"
              }
            )
          },
          {
            owner: "visitor",
            group: "staff",
            mtime: "2026-03-14T16:48:00-04:00"
          }
        )
      },
      {
        owner: "root",
        group: "wheel",
        mtime: "2026-03-14T16:48:00-04:00"
      }
    ),
    srv: directory(
      {
        http: directory(
          {
            "index.html": textFile(
              [
                "<!doctype html>",
                "<title>string.cat</title>",
                "<h1>string.cat</h1>"
              ],
              {
                owner: "www",
                group: "www",
                mime: "text/html; charset=utf-8",
                mtime: "2026-03-14T16:49:00-04:00"
              }
            ),
            "humans.txt": textFile(
              [
                "string.cat",
                "quiet domain, small surface area"
              ],
              {
                owner: "www",
                group: "www",
                mtime: "2026-03-14T16:49:00-04:00"
              }
            )
          },
          {
            owner: "www",
            group: "www",
            mtime: "2026-03-14T16:49:00-04:00"
          }
        )
      },
      {
        owner: "root",
        group: "wheel",
        mtime: "2026-03-14T16:49:00-04:00"
      }
    ),
    var: directory(
      {
        log: directory(
          {
            "access.log": textFile(
              [
                "2026-03-14T16:12:07Z GET / 200",
                "2026-03-14T16:12:08Z GET /og.png 200"
              ],
              {
                owner: "root",
                group: "wheel",
                mtime: "2026-03-14T16:50:00-04:00"
              }
            ),
            "mail.log": textFile(
              [
                "2026-03-14T15:58:44Z queue active",
                "2026-03-14T15:58:46Z delivery ok"
              ],
              {
                owner: "root",
                group: "wheel",
                mtime: "2026-03-14T16:50:00-04:00"
              }
            )
          },
          {
            owner: "root",
            group: "wheel",
            mtime: "2026-03-14T16:50:00-04:00"
          }
        )
      },
      {
        owner: "root",
        group: "wheel",
        mtime: "2026-03-14T16:50:00-04:00"
      }
    )
  },
  {
    owner: "root",
    group: "wheel",
    mtime: "2026-03-14T16:50:00-04:00"
  }
);

window.__STRING_CAT_SHELL_DATA__ = Object.freeze({
  bootLines,
  fileSystem,
  shellConfig
});
