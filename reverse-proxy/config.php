<?php
declare(strict_types=1);

/**
 * Configuration du serveur web distant.
 *
 * Exemple :
 * http://A.B.C.D:41100
 * Si le serveur distant utilise HTTPS :
 * https://A.B.C.D:41100
 */

// adresse IP publique et port NAT
// du serveur distant (Raspberry PI ou VPS)
const REMOTE_SERVER = 'http://147.93.54.78:18080';

/**
 * Timeout de connexion en secondes.
 */
const CONNECT_TIMEOUT = 10;

/**
 * Timeout total de la requête en secondes.
 */
const REQUEST_TIMEOUT = 120;

