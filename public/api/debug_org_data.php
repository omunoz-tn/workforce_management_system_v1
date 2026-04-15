<?php
require_once 'db_wfm_config.php';
header('Content-Type: application/json');

try {
    $groups = $pdo->query("SELECT * FROM org_groups ORDER BY id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
    $teams = $pdo->query("SELECT * FROM org_teams ORDER BY id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['groups' => $groups, 'teams' => $teams], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
