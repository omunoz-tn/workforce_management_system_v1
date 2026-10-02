<?php
/**
 * manage_companies.php
 * The company list behind Configuration > HR > Company.
 *
 * GET                   -> every company, alphabetically
 * POST   { name }       -> add one
 * PUT    { id, name }   -> rename one
 * DELETE ?id=N          -> remove one
 *
 * Rename is here alongside add and remove on purpose: other records will start pointing at
 * these ids, and fixing a typo by deleting and re-adding would break every one of those
 * links. Correcting the name in place keeps them.
 */
header('Content-Type: application/json');
require_once 'db_wfm_config.php';
require_once 'Companies.php';

ensureCompaniesTable($pdo);

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    try {
        echo json_encode(['success' => true, 'data' => fetchCompanies($pdo)]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];

    try {
        $name = normalizeCompanyName($data['name'] ?? null);

        $stmt = $pdo->prepare('INSERT INTO org_companies (name) VALUES (:name)');
        $stmt->execute(['name' => $name]);

        echo json_encode(['success' => true, 'id' => (int) $pdo->lastInsertId(), 'name' => $name]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'That company is already on the list.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = isset($data['id']) ? (int) $data['id'] : 0;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    try {
        $name = normalizeCompanyName($data['name'] ?? null);

        $stmt = $pdo->prepare('UPDATE org_companies SET name = :name WHERE id = :id');
        $stmt->execute(['name' => $name, 'id' => $id]);

        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Another company already has that name.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare('DELETE FROM org_companies WHERE id = :id');
        $stmt->execute(['id' => $id]);

        echo json_encode(['success' => true, 'deleted' => $stmt->rowCount()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
?>
