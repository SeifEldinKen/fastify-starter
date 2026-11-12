import { REQUIRE_SUDO } from './sudo.script.js'

// --> Printed by the script before each part of its output
export const FIREWALL_MARKER = '@@SERVER-PANEL:'

const MARKER = FIREWALL_MARKER

export const getFirewallScript = () => {
  return /* SHELL */ `
    PATH="$PATH:/usr/sbin:/sbin"

    ${REQUIRE_SUDO}

    echo "${MARKER}SSH $SSH_CONNECTION"

    if [ -S /var/run/docker.sock ]; then
      echo "${MARKER}DOCKER"
    fi

    backend=none
    active=0

    if command -v ufw >/dev/null 2>&1 && LC_ALL=C $S ufw status 2>/dev/null </dev/null | grep -q "^Status: active"; then
      backend=ufw
      active=1
    elif command -v firewall-cmd >/dev/null 2>&1 && $S firewall-cmd --state 2>/dev/null </dev/null | grep -qx running; then
      backend=firewalld
      active=1
    elif command -v ufw >/dev/null 2>&1; then
      backend=ufw
    elif command -v firewall-cmd >/dev/null 2>&1; then
      backend=firewalld
    elif command -v iptables >/dev/null 2>&1; then
      if $S iptables -S INPUT 2>/dev/null </dev/null | grep -qvx -- "-P INPUT ACCEPT"; then backend=raw; fi
    elif command -v nft >/dev/null 2>&1; then
      if $S nft list ruleset 2>/dev/null </dev/null | grep -q "hook input"; then backend=raw; fi
    fi

    echo "${MARKER}BACKEND $backend $active"

    if [ "$backend" = ufw ]; then
      echo "${MARKER}DEFAULTS"
      $S grep -E "^(IPV6|DEFAULT_INPUT_POLICY|DEFAULT_OUTPUT_POLICY)=" /etc/default/ufw 2>/dev/null </dev/null

      echo "${MARKER}RULES"
      LC_ALL=C $S ufw show added 2>/dev/null </dev/null

      echo "${MARKER}APPS"
      $S cat /etc/ufw/applications.d/* 2>/dev/null </dev/null
    fi

    if [ "$backend" = firewalld ] && [ "$active" = 1 ]; then
      zone=$($S firewall-cmd --get-default-zone 2>/dev/null </dev/null)

      echo "${MARKER}ZONE $zone"

      echo "${MARKER}ACTIVE_ZONES"
      $S firewall-cmd --get-active-zones 2>/dev/null </dev/null

      echo "${MARKER}PERMANENT"
      $S firewall-cmd --permanent --zone="$zone" --list-all 2>/dev/null </dev/null

      echo "${MARKER}RUNTIME"
      $S firewall-cmd --zone="$zone" --list-all 2>/dev/null </dev/null

      echo "${MARKER}SERVICES"
      names=$(
        {
          $S firewall-cmd --permanent --zone="$zone" --list-services 2>/dev/null </dev/null
          $S firewall-cmd --permanent --zone="$zone" --list-rich-rules 2>/dev/null </dev/null \\
            | sed -n "s/.*service name=\\"\\([^\\"]*\\)\\".*/\\1/p"
        } | tr " " "\\n" | sort -u
      )
      for service in $names; do
        echo "$service $($S firewall-cmd --permanent --service="$service" --get-ports 2>/dev/null </dev/null)"
      done
    fi

    echo "${MARKER}END"
  `
}
