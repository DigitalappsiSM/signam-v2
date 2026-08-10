import { initializeApp } from 'firebase-admin/app';

/**
 * Punto de entrada de las Cloud Functions de SIGNAM V2.
 *
 * Inicializa la app de administración y reexporta las funciones por módulo.
 * En esta primera entrega la estructura está establecida; las funciones
 * concretas se implementarán en iteraciones posteriores.
 */
initializeApp();

export * as imports from './imports';
export * as consolidation from './consolidation';
export * as exports from './exports';
export * as users from './users';
