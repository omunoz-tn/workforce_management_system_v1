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
RUN apt-get update && apt-get install -y \
    libcurl4-openssl-dev \
    libssl-dev \
    cron \
    && docker-php-ext-install pdo pdo_mysql curl \
    && apt-get clean && rm -rf /var/www/html/*

# Create the cron job file
RUN echo "0 6 * * * /usr/local/bin/php /var/www/html/api/sync_auto_background.php >> /var/log/cron.log 2>&1" > /etc/cron.d/sync-cron \
    && chmod 0644 /etc/cron.d/sync-cron \
    && crontab /etc/cron.d/sync-cron \
    && touch /var/log/cron.log

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Copy built assets and PHP API from build-stage dist folder
COPY --from=build-stage /app/dist /var/www/html/

# Ensure proper permissions for Apache and cron logs
RUN chown -R www-data:www-data /var/www/html/ \
    && chown www-data:www-data /var/log/cron.log

# Start cron and Apache
CMD ["sh", "-c", "cron && apache2-foreground"]

# Expose port 80
EXPOSE 80
