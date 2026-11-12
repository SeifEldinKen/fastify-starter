import { FIREWALL_MARKER } from './get-firewall.script.js'
import { REQUIRE_SUDO } from './sudo.script.js'

const MARKER = FIREWALL_MARKER

// --> Where the server keeps what is needed to undo a change, until the panel confirms it. Lost on reboot, on purpose
const STATE_DIRECTORY = '/run/server-panel-firewall'

// --> The start of both scripts. Every value is read from the input (stdin), nothing typed by a user is part of a command
// a change is made in two runs: "apply" changes the firewall and starts a timer that undoes it,
// "commit" stops the timer. The panel only commits over a new connection: when the change locked it out,
// no commit comes and the server undoes the change by itself
const PRELUDE = /* SHELL */ `
  PATH="$PATH:/usr/sbin:/sbin"

  IFS= read -r phase
  IFS= read -r operation
  IFS= read -r action
  IFS= read -r port
  IFS= read -r protocol
  IFS= read -r sources
  IFS= read -r comment
  IFS= read -r timeout

  dir=${STATE_DIRECTORY}

  fail() { echo "${MARKER}ERROR:$1"; exit 0; }

  ${REQUIRE_SUDO}

  is_pending() {
    pid=$($S cat "$dir/pid" 2>/dev/null)
    [ -n "$pid" ] && $S kill -0 "$pid" 2>/dev/null
  }

  stop_timer() { is_pending && $S kill "$pid" 2>/dev/null; }

  undo_now() { stop_timer; $S sh "$dir/undo.sh" >/dev/null 2>&1 </dev/null; }

  start_timer() {
    $S tee "$dir/rollback.sh" >/dev/null <<EOF
PATH="\\$PATH:/usr/sbin:/sbin"
echo \\$\\$ > $dir/pid
sleep $timeout
sh $dir/undo.sh
EOF
    $S setsid nohup sh "$dir/rollback.sh" >/dev/null 2>&1 </dev/null &

    tries=0
    until $S test -s "$dir/pid"; do
      tries=$((tries + 1))
      [ "$tries" -lt 50 ] || { $S rm -rf "$dir"; fail FAILED; }
      sleep 0.1
    done
  }

  lock() {
    if ! $S mkdir "$dir" 2>/dev/null; then
      if is_pending; then fail BUSY; fi
      $S rm -rf "$dir"
      $S mkdir "$dir" || fail FAILED
    fi
  }
`

// --> ufw saves a change at once, so the two files that hold its rules are copied first: undoing puts them back
const UFW_SCRIPT = /* SHELL */ `
  ${PRELUDE}

  if [ "$phase" = commit ]; then
    stop_timer || fail ROLLED_BACK
    $S rm -rf "$dir"
    echo "${MARKER}OK"
    exit 0
  fi

  lock
  $S cp -p /etc/ufw/user.rules /etc/ufw/user6.rules "$dir/" || { $S rm -rf "$dir"; fail FAILED; }

  $S tee "$dir/undo.sh" >/dev/null <<EOF
PATH="\\$PATH:/usr/sbin:/sbin"
cp -p $dir/user.rules $dir/user6.rules /etc/ufw/
ufw reload
rm -rf $dir
EOF

  start_timer

  for source in $sources; do
    if [ -z "$port" ]; then
      set -- from "$source"
    elif [ "$protocol" = any ]; then
      set -- from "$source" to any port "$port"
    else
      set -- from "$source" to any port "$port" proto "$protocol"
    fi

    if [ "$operation" = add ]; then
      if [ -n "$comment" ]; then set -- "$@" comment "$comment"; fi
      output=$(LC_ALL=C $S ufw "$action" "$@" 2>&1 </dev/null)
    else
      output=$(LC_ALL=C $S ufw delete "$action" "$@" 2>&1 </dev/null)
    fi

    status=$?
    echo "$output" >&2

    case "$output" in
      *non-existent*) undo_now; fail RULE_NOT_FOUND ;;
    esac

    if [ "$status" != 0 ]; then undo_now; fail FAILED; fi
  done

  echo "${MARKER}OK"
`

// --> firewalld keeps two copies of its rules: "apply" changes the running one only, and writes down each change made,
// undoing is the opposite change, and "commit" repeats the same changes on the saved copy
const FIREWALLD_SCRIPT = /* SHELL */ `
  ${PRELUDE}

  zone=$($S firewall-cmd --get-default-zone 2>/dev/null </dev/null)
  [ -n "$zone" ] || fail FAILED

  if [ "$operation" = add ]; then forward=add; backward=remove; else forward=remove; backward=add; fi

  firewall() { $S firewall-cmd "$@" 2>&1 </dev/null; }

  if [ "$phase" = commit ]; then
    stop_timer || fail ROLLED_BACK

    while IFS="|" read -r kind value; do
      [ -n "$kind" ] || continue
      firewall --permanent --zone="$zone" "--$forward-$kind=$value" >&2 || fail SAVE_FAILED
    done <<EOF
$($S cat "$dir/changes" 2>/dev/null)
EOF

    $S rm -rf "$dir"
    echo "${MARKER}OK"
    exit 0
  fi

  lock
  $S touch "$dir/changes"

  $S tee "$dir/undo.sh" >/dev/null <<EOF
PATH="\\$PATH:/usr/sbin:/sbin"
while IFS="|" read -r kind value; do
  firewall-cmd --zone=$zone "--$backward-\\$kind=\\$value"
done < $dir/changes
rm -rf $dir
EOF

  start_timer

  for source in $sources; do
    kind=""

    if [ "$source" = any ] && [ "$action" = allow ] && [ -n "$port" ]; then
      # --> open to everyone: a port of the zone, or the service that stands for this port (ssh is 22/tcp)
      value="$port/$protocol"

      if [ "$operation" = add ] || firewall --zone="$zone" "--query-port=$value" >/dev/null; then
        kind=port
      else
        for service in $(firewall --zone="$zone" --list-services); do
          if [ "$(firewall --permanent "--service=$service" --get-ports)" = "$value" ]; then
            kind=service
            value=$service
            break
          fi
        done

        # --> or a rule written in the long form, without address
        rich="rule port port=\\"$port\\" protocol=\\"$protocol\\" accept"

        if [ -z "$kind" ] && firewall --zone="$zone" "--query-rich-rule=$rich" >/dev/null; then
          kind=rich-rule
          value=$rich
        fi
      fi
    else
      case "$action" in
        allow) verb=accept ;;
        deny) verb=drop ;;
        reject) verb=reject ;;
        *) undo_now; fail FAILED ;;
      esac

      value="rule"

      if [ "$source" != any ]; then
        case "$source" in
          *:*) family=ipv6 ;;
          *) family=ipv4 ;;
        esac
        value="$value family=\\"$family\\" source address=\\"$source\\""
      fi

      if [ -n "$port" ]; then value="$value port port=\\"$port\\" protocol=\\"$protocol\\""; fi

      value="$value $verb"
      kind=rich-rule
    fi

    if [ -z "$kind" ]; then undo_now; fail RULE_NOT_FOUND; fi

    if firewall --zone="$zone" "--query-$kind=$value" >/dev/null; then is_there=1; else is_there=0; fi

    if [ "$operation" = add ] && [ "$is_there" = 1 ]; then
      # --> already running, it only has to be saved by the commit
      printf "%s|%s\\n" "$kind" "$value" | $S tee -a "$dir/changes" >/dev/null
      continue
    fi

    if [ "$operation" = delete ] && [ "$is_there" = 0 ]; then undo_now; fail RULE_NOT_FOUND; fi

    if ! firewall --zone="$zone" "--$forward-$kind=$value" >&2; then undo_now; fail FAILED; fi

    printf "%s|%s\\n" "$kind" "$value" | $S tee -a "$dir/changes" >/dev/null
  done

  echo "${MARKER}OK"
`

export interface ChangeFirewallRulesScriptInput {
  // --> "apply" makes the change and starts the timer that undoes it, "commit" stops the timer and keeps the change
  phase: 'apply' | 'commit'
  operation: 'add' | 'delete'
  action: string
  // --> null for every port
  port: string | null
  protocol: string
  // --> "any", addresses or networks: one rule is changed for each
  sources: string[]
  comment: string
  // --> Seconds before the server undoes a change that was not committed
  timeoutSeconds: number
}

// --> One value per line: every value must be validated by the caller first, none of them can contain a line break
const toStdin = (input: ChangeFirewallRulesScriptInput, port: string): string => {
  return [
    input.phase,
    input.operation,
    input.action,
    port,
    input.protocol,
    input.sources.join(' '),
    input.comment,
    String(input.timeoutSeconds),
    '',
  ].join('\n')
}

// --> The script that adds or deletes rules with ufw, with its input: run them with sshCommandRunner.runScript
export const changeUfwRulesScript = (input: ChangeFirewallRulesScriptInput): { script: string; stdin: string } => {
  return {
    script: UFW_SCRIPT,
    // --> ufw writes a range of ports with ":"
    stdin: toStdin(input, (input.port ?? '').replaceAll('-', ':')),
  }
}

// --> The script that adds or deletes rules with firewalld, with its input: run them with sshCommandRunner.runScript
export const changeFirewalldRulesScript = (
  input: ChangeFirewallRulesScriptInput,
): { script: string; stdin: string } => {
  return {
    script: FIREWALLD_SCRIPT,
    stdin: toStdin(input, input.port ?? ''),
  }
}
