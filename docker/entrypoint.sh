#!/bin/sh
set -e

# cron launches jobs with a scrubbed environment, so anything docker-compose injects is
# invisible to the sync job. Persist it for the cron job to source.
#
# In practice that is only TZ today: database and API credentials all come from the
# mounted .env, which db_wfm_config.php reads directly. Exporting them here would defeat
# that, because getenv() wins over the file — a value captured at container start would
# then outrank a .env edited later. This seam stays so a future compose variable reaches
# cron without rediscovering why it does not.
printenv \
  | grep -E '^(TZ=)' \
  | sed -E "s/'/'\\\\''/g" \
  | sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/export \1='\2'/" \
  > /etc/container-env.sh
chmod 0600 /etc/container-env.sh

cron
exec apache2-foreground
