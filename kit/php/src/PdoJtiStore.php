<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/**
 * jti en una tabla con clave primaria (MySQL/MariaDB/Postgres/SQLite):
 *   CREATE TABLE sso_jti_usados (jti VARCHAR(128) PRIMARY KEY, expira_en BIGINT NOT NULL);
 * El INSERT con clave duplicada es la operacion atomica.
 */
final class PdoJtiStore implements JtiStore
{
    public function __construct(private \PDO $pdo, private string $tabla = 'sso_jti_usados')
    {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $tabla)) {
            throw new \InvalidArgumentException('Nombre de tabla invalido');
        }
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    }

    public function usar(string $jti, int $expiraEn): bool
    {
        if (random_int(1, 50) === 1) {
            $this->pdo->prepare("DELETE FROM {$this->tabla} WHERE expira_en < ?")->execute([time() - 600]);
        }
        try {
            $st = $this->pdo->prepare("INSERT INTO {$this->tabla} (jti, expira_en) VALUES (?, ?)");
            $st->execute([$jti, $expiraEn]);
            return true;
        } catch (\PDOException $e) {
            // SQLSTATE 23xxx = violacion de integridad (duplicado). Otro error: no dejar pasar.
            if (str_starts_with((string) $e->getCode(), '23')) {
                return false;
            }
            throw $e;
        }
    }
}
