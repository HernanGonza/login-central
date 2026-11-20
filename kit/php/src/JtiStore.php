<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/**
 * Almacenamiento enchufable de jti usados (un solo uso, solo para use=login).
 * usar() debe ser ATOMICO: si dos pedidos presentan el mismo jti a la vez,
 * solo uno recibe true.
 */
interface JtiStore
{
    /** Marca el jti como usado. true = primera vez; false = ya estaba usado. */
    public function usar(string $jti, int $expiraEn): bool;
}
