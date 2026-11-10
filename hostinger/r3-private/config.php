<?php
/**
 * Configuración privada del API de R3 Puntos.
 * Ubicación en Hostinger (FUERA de public_html):   domains/r3reddetalleres.com/r3-private/config.php
 * Junto a este archivo va service-account.json (Firebase → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada).
 */
return [
    'projectId' => 'r3-puntos',
    'serviceAccountFile' => __DIR__ . '/service-account.json',
    // Dirección pública de la app (para las URLs de las imágenes de premios)
    'publicBaseUrl' => 'https://puntos.r3reddetalleres.com',
];
