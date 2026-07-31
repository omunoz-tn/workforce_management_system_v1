<?php
header('Content-Type: application/json');
require_once 'db_wfm_config.php';

// Try to connect to Odoo
$odoo_host = $env['ODOO_DB_HOST'] ?? '';
$odoo_port = $env['ODOO_DB_PORT'] ?? '5432';
$odoo_name = $env['ODOO_DB_NAME'] ?? '';
$odoo_user = $env['ODOO_DB_USER'] ?? '';
$odoo_pass = $env['ODOO_DB_PASS'] ?? '';

try {
    $odoo_pdo = new PDO("pgsql:host=$odoo_host;port=$odoo_port;dbname=$odoo_name", $odoo_user, $odoo_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => 'Odoo Connection Failed: ' . $e->getMessage()]);
    exit;
}

try {
    // 1. Fetch data from Odoo
    $sql = "
        SELECT
            e.id as employee_id,
            e.name as employee_name,
            e.active as is_active,
            e.identification_id as identification_number,
            e.gender as gender,
            e.birthday as date_of_birth,
            e.marital as marital_status,
            rc.name as country_name,
            e.x_site_country as site_country_name,
            c.name as company_name,
            d.name as department_name,
            e.private_city as private_city,
            rs.name as private_state,
            e.private_zip as private_zip,
            e.x_desktime_id as desktime_id,
            e.x_entry_date as entry_date,
            e.work_email as work_email,
            e.work_phone as work_phone,
            e.job_title as job_title,
            wl.name as work_location,
            ru.login as user_login,
            e.private_email as personal_email,
            e.private_phone as personal_phone,
            e.mobile_phone as personal_mobile,
            e.create_date as created_at,
            e.write_date as last_updated
        FROM hr_employee e
        LEFT JOIN res_country rc ON e.country_id = rc.id
        LEFT JOIN res_company c ON e.company_id = c.id
        LEFT JOIN hr_department d ON e.department_id = d.id
        LEFT JOIN res_country_state rs ON e.private_state_id = rs.id
        LEFT JOIN hr_work_location wl ON e.work_location_id = wl.id
        LEFT JOIN res_users ru ON e.user_id = ru.id
    ";

    $stmt = $odoo_pdo->query($sql);
    $odooEmployees = $stmt->fetchAll();

    if (empty($odooEmployees)) {
        echo json_encode(['success' => true, 'message' => 'No employees found in Odoo.']);
        exit;
    }

    // 2. Prepare UPSERT for MySQL
    // Note: ON DUPLICATE KEY UPDATE will update the fields if employee_id already exists.
    $insertSql = "
        INSERT INTO odoo_employee_data (
            employee_id, employee_name, is_active, identification_number, gender,
            date_of_birth, marital_status, country_name, site_country_name,
            company_name, department_name, private_city, private_state,
            private_zip, desktime_id, entry_date, work_email, work_phone, job_title,
            work_location, user_login, personal_email, personal_phone, personal_mobile,
            created_at, last_updated
        ) VALUES (
            :employee_id, :employee_name, :is_active, :identification_number, :gender,
            :date_of_birth, :marital_status, :country_name, :site_country_name,
            :company_name, :department_name, :private_city, :private_state,
            :private_zip, :desktime_id, :entry_date, :work_email, :work_phone, :job_title,
            :work_location, :user_login, :personal_email, :personal_phone, :personal_mobile,
            :created_at, :last_updated
        ) ON DUPLICATE KEY UPDATE
            employee_name = VALUES(employee_name),
            is_active = VALUES(is_active),
            identification_number = VALUES(identification_number),
            gender = VALUES(gender),
            date_of_birth = VALUES(date_of_birth),
            marital_status = VALUES(marital_status),
            country_name = VALUES(country_name),
            site_country_name = VALUES(site_country_name),
            company_name = VALUES(company_name),
            department_name = VALUES(department_name),
            private_city = VALUES(private_city),
            private_state = VALUES(private_state),
            private_zip = VALUES(private_zip),
            desktime_id = VALUES(desktime_id),
            entry_date = VALUES(entry_date),
            work_email = VALUES(work_email),
            work_phone = VALUES(work_phone),
            job_title = VALUES(job_title),
            work_location = VALUES(work_location),
            user_login = VALUES(user_login),
            personal_email = VALUES(personal_email),
            personal_phone = VALUES(personal_phone),
            personal_mobile = VALUES(personal_mobile),
            created_at = VALUES(created_at),
            last_updated = VALUES(last_updated)
    ";

    $insertStmt = $pdo->prepare($insertSql);
    $pdo->beginTransaction();

    $syncedCount = 0;
    foreach ($odooEmployees as $emp) {
        $insertStmt->execute([
            ':employee_id' => $emp['employee_id'],
            ':employee_name' => $emp['employee_name'],
            ':is_active' => $emp['is_active'] ? 1 : 0,
            ':identification_number' => $emp['identification_number'],
            ':gender' => $emp['gender'],
            ':date_of_birth' => $emp['date_of_birth'] ?: null,
            ':marital_status' => $emp['marital_status'],
            ':country_name' => $emp['country_name'] ?: 'Unknown', // Sometimes name in res_country can be JSON if translatable, but we assume string here
            ':site_country_name' => $emp['site_country_name'],
            ':company_name' => $emp['company_name'],
            ':department_name' => $emp['department_name'],
            ':private_city' => $emp['private_city'],
            ':private_state' => $emp['private_state'],
            ':private_zip' => $emp['private_zip'],
            ':desktime_id' => $emp['desktime_id'],
            ':entry_date' => $emp['entry_date'] ?: null,
            ':work_email' => $emp['work_email'],
            ':work_phone' => $emp['work_phone'],
            ':job_title' => $emp['job_title'],
            ':work_location' => $emp['work_location'],
            ':user_login' => $emp['user_login'],
            ':personal_email' => $emp['personal_email'],
            ':personal_phone' => $emp['personal_phone'],
            ':personal_mobile' => $emp['personal_mobile'],
            ':created_at' => $emp['created_at'] ?: date('Y-m-d H:i:s'),
            ':last_updated' => $emp['last_updated'] ?: date('Y-m-d H:i:s')
        ]);
        $syncedCount++;
    }

    $pdo->commit();

    echo json_encode([
        'success' => true,
        'message' => 'Synchronization completed successfully.',
        'synced_records' => $syncedCount
    ]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
