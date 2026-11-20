<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/** Solo para pruebas (no persiste entre pedidos de PHP-FPM). */
final class MemoriaJtiStore implements JtiStore
{
    /** @var array<string,int> */
    private array $usados = [];

    public function usar(string $jti, int $expiraEn): bool
    {
        if (isset($this->usados[$jti])) {
            return false;
        }
        $this->usados[$jti] = $expiraEn;
        return true;
    }
}
