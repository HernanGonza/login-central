<?php
declare(strict_types=1);

spl_autoload_register(static function (string $c): void {
    if (str_starts_with($c, 'Ministerio\\Sso\\')) {
        $f = __DIR__ . '/' . substr($c, strlen('Ministerio\\Sso\\')) . '.php';
        if (is_file($f)) {
            require $f;
        }
    }
});
