<?php
declare(strict_types=1);

namespace Ministerio\Sso;

/** Un archivo por jti en un directorio (creacion exclusiva = atomica). Sin base de datos. */
final class ArchivoJtiStore implements JtiStore
{
    public function __construct(private string $dir, private int $retencion = 300)
    {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new \RuntimeException('No se pudo crear el directorio de jti');
        }
        // Verifica por si mismo (no confia en quien lo llama): directorio propio, no enlace, modo 0700.
        clearstatcache(true, $dir);
        if (is_link($dir) || !is_dir($dir)) {
            throw new \RuntimeException('El directorio de jti no es un directorio propio');
        }
        $uid = function_exists('posix_geteuid') ? posix_geteuid() : getmyuid();
        if (fileowner($dir) !== $uid) {
            throw new \RuntimeException('El directorio de jti no pertenece al usuario actual');
        }
        if ((fileperms($dir) & 0777) !== 0700) {
            throw new \RuntimeException('El directorio de jti debe tener modo 0700');
        }
    }

    public function usar(string $jti, int $expiraEn): bool
    {
        $ruta = $this->dir . '/' . hash('sha256', $jti) . '.jti';
        $fh = @fopen($ruta, 'x'); // falla si ya existe
        if ($fh === false) {
            return false;
        }
        fwrite($fh, (string) $expiraEn);
        fclose($fh);
        if (random_int(1, 50) === 1) {
            $this->limpiar();
        }
        return true;
    }

    private function limpiar(): void
    {
        $limite = time() - $this->retencion - 120;
        foreach (glob($this->dir . '/*.jti') ?: [] as $f) {
            $exp = (int) @file_get_contents($f);
            if ($exp > 0 && $exp < $limite) {
                @unlink($f);
            }
        }
    }
}
