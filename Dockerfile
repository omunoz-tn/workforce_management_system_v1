# Stage 1: Build the Vite Frontend
FROM node:20-alpine AS build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve with PHP-Apache
FROM php:8.2-apache
WORKDIR /var/www/html

# Install system dependencies, PHP extensions, and cron
# libpq-dev / pdo_pgsql are for Odoo: it runs on PostgreSQL, so sync_odoo_employees.php
# cannot connect without them. The image shipped with pdo_mysql only, which is why that
# sync could never have worked from the container -- it failed with "could not find driver"
# before it ever reached the network.
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    libssl-dev \
    libpq-dev \
    cron \
    && docker-php-ext-install pdo pdo_mysql pdo_pgsql curl \
    && apt-get clean && rm -rf /var/www/html/*

# Install the daily sync cron job (runs as root via /etc/cron.d)
COPY docker/sync-cron /etc/cron.d/sync-cron
RUN chmod 0644 /etc/cron.d/sync-cron \
    && chown root:root /etc/cron.d/sync-cron \
    && touch /var/log/cron.log

# Entrypoint exports the container environment for cron, then starts cron + Apache
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Copy built assets and PHP API from build-stage dist folder
COPY --from=build-stage /app/dist /var/www/html/

# Ensure proper permissions for Apache and cron logs
RUN chown -R www-data:www-data /var/www/html/ \
    && chown www-data:www-data /var/log/cron.log

CMD ["/usr/local/bin/entrypoint.sh"]

# Expose port 80
EXPOSE 80
