<?php
/**
 * db_sources.php
 * The databases Analytics > Databases is allowed to open, and how to reach each one.
 *
 * The viewer was hard-wired to the $pdo built by db_wfm_config.php, so "Databases" could
 * only ever mean the WFM platform database. Sources are declared here instead, keyed by
 * the short id the request carries (?source=). That id decides which server a SHOW TABLES
 * runs against, so it is resolved here and never reaches a DSN as raw request input.
 *
 * A source can be declared two ways:
 *
 *   - pinned to one database, when its _NAME is set in .env. One entry in the picker.
 *   - server-wide, when _NAME is empty. The server is asked for its schemas and each one
 *     becomes its own entry (telecom:facturacion, telecom:reportes, ...), which is what the
 *     telecom container wants: nobody has to know a schema name in advance, and one added
 *     later shows up on the next page load.
 *
 * A source missing its host or user in .env is not offered at all: a half-configured
 * connection is better shown as an absent entry than as one that fails when clicked.
 *
 * Credentials belong in .env and nowhere else -- see the note in docker-compose.yml about
 * compose interpolating values once at container creation, which is how the app once
 * stayed pinned to a stale database.
 */

/** MySQL's own bookkeeping schemas, never worth listing in a data viewer. */
const DB_SYSTEM_SCHEMAS = ['information_schema', 'performance_schema', 'mysql', 'sys'];

/**
 * Every known source, configured or not. `pass` never leaves this file; db_sources_list()
 * is what the browser sees.
 */
function db_source_definitions(array $env): array
{
    return [
        'wfm' => [
            'label' => 'WFM Platform',
            'host' => $env['DB_HOST'] ?? '',
            'port' => (int) ($env['DB_PORT'] ?? 3306),
            'name' => $env['DB_NAME'] ?? '',
            'user' => $env['DB_USER'] ?? '',
            'pass' => $env['DB_PASS'] ?? '',
            'charset' => 'utf8',
        ],
        // The telecom_mysql container. A separate server, not a second schema on DB_HOST, so
        // it carries its own credentials rather than reusing DB_USER. TELECOM_DB_NAME is left
        // empty on purpose: the whole server is browsable, schema by schema.
        'telecom' => [
            'label' => 'Telecom',
            'host' => $env['TELECOM_DB_HOST'] ?? '',
            'port' => (int) ($env['TELECOM_DB_PORT'] ?? 3306),
            'name' => $env['TELECOM_DB_NAME'] ?? '',
            'user' => $env['TELECOM_DB_USER'] ?? '',
            'pass' => $env['TELECOM_DB_PASS'] ?? '',
            'charset' => 'utf8mb4',
        ],
    ];
}

/** True once a source has enough of .env filled in to be worth offering. */
function db_source_is_configured(array $source): bool
{
    return $source['host'] !== '' && $source['user'] !== '';
}

/**
 * Opens one connection. A null $schema connects to the server without selecting a
 * database, which is what listing its schemas needs.
 *
 * The schema reaches a DSN, not a query, and is matched against MySQL's identifier charset
 * first -- anything carrying a ';' or '=' could otherwise append DSN options.
 */
function db_open(array $source, ?string $schema): PDO
{
    $dsn = "mysql:host={$source['host']};port={$source['port']}";
    if ($schema !== null) {
        if (!preg_match('/^[A-Za-z0-9_$-]+$/', $schema)) {
            throw new InvalidArgumentException("Invalid database name '$schema'.");
        }
        $dsn .= ";dbname=$schema";
    }
    $dsn .= ";charset={$source['charset']}";

    return new PDO($dsn, $source['user'], $source['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Same 5s ceiling as the platform connection: an unreachable host has to fail fast
        // enough that the viewer reports it instead of hanging.
        PDO::ATTR_TIMEOUT => 5,
    ]);
}

/** The schemas a server offers, minus MySQL's own. */
function db_server_schemas(array $source): array
{
    $schemas = db_open($source, null)->query('SHOW DATABASES')->fetchAll(PDO::FETCH_COLUMN);
    return array_values(array_filter(
        $schemas,
        fn($schema) => !in_array(strtolower($schema), DB_SYSTEM_SCHEMAS, true)
    ));
}

/**
 * The entries the picker in the viewer renders. Host and database are included so an admin
 * can tell at a glance which server they are reading; the password is not.
 *
 * `warnings` carries servers that could not be listed. A telecom container that is down
 * must not cost the user the platform database as well, so its failure is reported next to
 * the sources that did answer instead of failing the whole request.
 *
 * @return array{sources:array<int,array>,warnings:array<int,string>}
 */
function db_sources_list(array $env): array
{
    $sources = [];
    $warnings = [];

    foreach (db_source_definitions($env) as $id => $source) {
        if (!db_source_is_configured($source)) {
            continue;
        }

        if ($source['name'] !== '') {
            $sources[] = [
                'id' => $id,
                'label' => $source['label'],
                'host' => $source['host'],
                'port' => $source['port'],
                'database' => $source['name'],
            ];
            continue;
        }

        try {
            foreach (db_server_schemas($source) as $schema) {
                $sources[] = [
                    'id' => "$id:$schema",
                    'label' => "{$source['label']} - $schema",
                    'host' => $source['host'],
                    'port' => $source['port'],
                    'database' => $schema,
                ];
            }
        } catch (PDOException $e) {
            $warnings[] = "{$source['label']} ({$source['host']}:{$source['port']}): " . $e->getMessage();
        }
    }

    return ['sources' => $sources, 'warnings' => $warnings];
}

/**
 * Resolves a source id -- 'wfm', or 'telecom:schema' for a server-wide source -- to its
 * definition and the database it names.
 *
 * Shared by the connect path and by db_source_describe() on purpose: the viewer prints
 * where a table lives, and that label has to come from the same resolution that opened the
 * connection, or it could name a different server than the one it actually read.
 *
 * @return array{0:array,1:string} the source definition and the database to open
 */
function db_source_resolve(string $id, array $env): array
{
    [$baseId, $schema] = array_pad(explode(':', $id, 2), 2, null);

    $sources = db_source_definitions($env);
    if (!isset($sources[$baseId]) || !db_source_is_configured($sources[$baseId])) {
        throw new InvalidArgumentException("Unknown or unconfigured database source '$id'.");
    }
    $source = $sources[$baseId];

    // A pinned source ignores any schema in the id; a server-wide one requires it.
    $target = $source['name'] !== '' ? $source['name'] : $schema;
    if ($target === null || $target === '') {
        throw new InvalidArgumentException("Source '$baseId' needs a database name (use '$baseId:<database>').");
    }

    return [$source, $target];
}

/**
 * Where a source physically lives, for display next to the data it served. Carries the
 * host and port so an admin reading a schema can tell which server holds it without
 * opening .env -- the password stays in db_source_definitions() and never leaves it.
 *
 * @return array{label:string,host:string,port:int,database:string}
 */
function db_source_describe(string $id, array $env): array
{
    [$source, $target] = db_source_resolve($id, $env);

    return [
        'label' => $source['label'],
        'host' => $source['host'],
        'port' => $source['port'],
        'database' => $target,
    ];
}

/**
 * Opens a source by id. $default is the connection the caller already holds for 'wfm',
 * reused rather than dialled a second time on every request.
 *
 * Throws with the host and database named but never the credentials, since the message is
 * what the viewer shows when a server refuses it -- usually a container whose port is not
 * published, or an account MySQL only grants from localhost.
 */
function db_source_connect(string $id, array $env, ?PDO $default = null): PDO
{
    if ($id === 'wfm' && $default instanceof PDO) {
        return $default;
    }

    [$source, $target] = db_source_resolve($id, $env);

    try {
        return db_open($source, $target);
    } catch (PDOException $e) {
        throw new RuntimeException(
            "Cannot open '$target' on {$source['label']} ({$source['host']}:{$source['port']}): "
            . $e->getMessage()
        );
    }
}
