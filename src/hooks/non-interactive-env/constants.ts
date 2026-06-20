export const HOOK_NAME = "non-interactive-env"

export const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  HOMEBREW_NO_AUTO_UPDATE: "1",
  // 阻断交互式编辑器 - git rebase、commit 等
  GIT_EDITOR: ":",
  EDITOR: ":",
  VISUAL: "",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_MERGE_AUTOEDIT: "no",
  // 阻断分页器
  GIT_PAGER: "cat",
  PAGER: "cat",
  // NPM 非交互
  npm_config_yes: "true",
  // Pip 非交互
  PIP_NO_INPUT: "1",
  // Yarn 非交互
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

/**
 * 非交互环境的 Shell 命令指引。
 * 应遵循这些模式以避免在等待用户输入时挂起。
 */
export const SHELL_COMMAND_PATTERNS = {
  // 包管理器 - 始终使用非交互式标志
  npm: {
    bad: ["npm init", "npm install (prompts)"],
    good: ["npm init -y", "npm install --yes"],
  },
  apt: {
    bad: ["apt-get install pkg"],
    good: ["apt-get install -y pkg", "DEBIAN_FRONTEND=noninteractive apt-get install pkg"],
  },
  pip: {
    bad: ["pip install pkg (with prompts)"],
    good: ["pip install --no-input pkg", "PIP_NO_INPUT=1 pip install pkg"],
  },
  // Git 操作 - 始终提供消息/标志
  git: {
    bad: ["git commit", "git merge branch", "git add -p", "git rebase -i"],
    good: ["git commit -m 'msg'", "git merge --no-edit branch", "git add .", "git rebase --no-edit"],
  },
  // 系统命令 - 强制使用标志
  system: {
    bad: ["rm file (prompts)", "cp a b (prompts)", "ssh host"],
    good: ["rm -f file", "cp -f a b", "ssh -o BatchMode=yes host", "unzip -o file.zip"],
  },
  // 禁用命令 - 总会挂起
  banned: [
    "vim", "nano", "vi", "emacs",           // 编辑器
    "less", "more", "man",                   // 分页器
    "python (REPL)", "node (REPL)",          // 无 -c/-e 的 REPL
    "git add -p", "git rebase -i",           // 交互式 git 模式
  ],
  // 需要输入的脚本的兜底方案
  workarounds: {
    yesPipe: "yes | ./script.sh",
    heredoc: `./script.sh <<EOF
option1
option2
EOF`,
    expectAlternative: "Use environment variables or config files instead of expect",
  },
} as const
