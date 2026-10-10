// IndexedDB en memoria (implementación conforme al estándar) para ejecutar la lógica real con Dexie.
import 'fake-indexeddb/auto';

// Zona horaria del negocio (Colombia) para cálculos de días.
process.env.TZ = 'America/Bogota';
