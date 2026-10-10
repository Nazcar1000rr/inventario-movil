import { useState } from 'react';
import {
  AppError,
  analyzeImport,
  createBackup,
  errorMessage,
  formatDateTime,
  formatInt,
  getSafetySnapshotInfo,
  markBackupDone,
  parseBackup,
  restoreBackup,
  TABLE_LABEL,
  undoLastRestore,
  type ExportResult,
  type ImportAnalysis,
  type ParsedBackup,
  type TableName,
} from '../../core';
import { Icon } from '../components/Icon';
import { Badge, Card, confirmAction, Field, FormError, KV, Loading, Notice, Page, TextInput } from '../components/ui';
import { isNative, pickTextFile, platformName, saveToDocuments, shareFile, downloadFile } from '../platform';
import { db, practice, safetyName, toast, useAction, useLive } from '../store';

const SUMMARY_TABLES: TableName[] = ['inventories', 'products', 'units', 'purchases', 'sales', 'payments', 'returns', 'expenses', 'suppliers', 'customers', 'warranties', 'photos', 'consolidatedViews'];

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupScreen() {
  const lastBackup = useLive(async (d) => (await d.meta.get('lastBackupAt'))?.value ?? null);
  const safety = useLive(() => getSafetySnapshotInfo(safetyName));
  return (
    <Page title="Respaldo y restauración" help="backup" back="/mas">
      <Notice kind="warn" title="Tus datos viven solo en este dispositivo">
        Si desinstalas la app, borras los datos del navegador o pierdes el teléfono, se pierden. Haz respaldos con frecuencia y guárdalos fuera del teléfono (por ejemplo, envíalos a tu propio WhatsApp, correo o Drive).
      </Notice>
      {practice ? <Notice kind="warn" title="Estás en modo práctica">Los respaldos que hagas aquí contienen solo los datos de ejemplo. Sal del modo práctica para respaldar tus datos reales.</Notice> : null}
      <p className="small muted">Último respaldo: {lastBackup ? formatDateTime(lastBackup) : 'nunca'}</p>
      <ExportCard />
      <ImportCard />
      {safety ? <UndoCard createdAt={safety.createdAt} /> : null}
    </Page>
  );
}

function ExportCard() {
  const [usePassword, setUsePassword] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const act = useAction();
  const shareAct = useAction();
  const pwError = usePassword && pw.length > 0 && pw.length < 6 ? 'Mínimo 6 caracteres.' : usePassword && pw2 && pw !== pw2 ? 'Las contraseñas no coinciden.' : null;

  const prepare = async () => {
    if (usePassword && (pw.length < 6 || pw !== pw2)) return;
    const r = await act.run(() => createBackup(db, { password: usePassword ? pw : undefined }));
    if (r) setResult(r);
  };
  const share = async () => {
    if (!result) return;
    const outcome = await shareAct.run(() => shareFile(result.filename, result.text));
    if (outcome === 'shared' || outcome === 'downloaded') {
      await markBackupDone(db, result.createdAt);
      toast(outcome === 'downloaded' ? 'Respaldo descargado' : 'Respaldo enviado al menú del sistema');
    }
  };
  const saveDocs = async () => {
    if (!result) return;
    const path = await shareAct.run(() => saveToDocuments(result.filename, result.text));
    if (path) {
      await markBackupDone(db, result.createdAt);
      toast(`Guardado en ${path}`);
    }
  };

  return (
    <Card title="Exportar respaldo completo">
      <div className="stack">
        <p className="small">
          Crea un archivo con <strong>todos</strong> tus datos: inventarios, productos, unidades, compras, ventas, pagos, gastos, proveedores, compradores, garantías, fotos, historial y configuración.
        </p>
        <label className="check">
          <input type="checkbox" checked={usePassword} onChange={(e) => { setUsePassword(e.target.checked); setResult(null); }} /> Proteger con contraseña (cifrado AES-256)
        </label>
        {usePassword ? (
          <>
            <div className="grid-2">
              <Field label="Contraseña" htmlFor="bk-pw">
                <TextInput id="bk-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setResult(null); }} />
              </Field>
              <Field label="Repetir contraseña" htmlFor="bk-pw2" error={pwError}>
                <TextInput id="bk-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setResult(null); }} />
              </Field>
            </div>
            <Notice kind="warn">Si olvidas la contraseña, el respaldo no se podrá abrir. No existe forma de recuperarla: guárdala en un lugar seguro.</Notice>
          </>
        ) : null}
        {!result ? (
          <button className="btn primary block" disabled={act.busy || (usePassword && (pw.length < 6 || pw !== pw2))} onClick={() => void prepare()} data-testid="prepare-backup">
            {act.busy ? 'Preparando…' : 'Preparar respaldo'}
          </button>
        ) : (
          <div className="stack">
            <Notice kind="ok" title="Respaldo listo">
              <span className="wrap-anywhere">
                {result.filename} · {sizeLabel(result.bytes)} · {formatInt(result.counts.sales)} venta(s), {formatInt(result.counts.units + result.counts.products)} producto(s)/unidad(es)
              </span>
            </Notice>
            <button className="btn primary block" disabled={shareAct.busy} onClick={() => void share()} data-testid="share-backup">
              <Icon name="share" /> {isNative() ? 'Compartir / guardar…' : 'Guardar o compartir…'}
            </button>
            {platformName() === 'android' ? (
              <button className="btn block" disabled={shareAct.busy} onClick={() => void saveDocs()}>
                <Icon name="download" /> Guardar en Documentos del teléfono
              </button>
            ) : null}
            {!isNative() ? (
              <button className="btn block" onClick={() => { downloadFile(result.filename, result.text); void markBackupDone(db, result.createdAt); }} data-testid="download-backup">
                <Icon name="download" /> Descargar archivo
              </button>
            ) : null}
            <p className="tiny muted">
              Elige dónde guardarlo: Archivos/iCloud, Drive, correo, WhatsApp, AirDrop, Bluetooth… Transferirlo a otro teléfono es una copia manual, no una sincronización: después cada teléfono cambia por separado.
            </p>
          </div>
        )}
        <FormError error={act.error ?? shareAct.error} />
      </div>
    </Card>
  );
}

function ImportCard() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pw, setPw] = useState('');
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  const reset = () => {
    setFile(null);
    setNeedPw(false);
    setPw('');
    setParsed(null);
    setAnalysis(null);
    setForce(false);
    setError(null);
  };

  const read = async (f: { name: string; text: string }, password?: string) => {
    setBusy(true);
    setError(null);
    try {
      const p = await parseBackup(f.text, password);
      const a = await analyzeImport(db, p);
      setParsed(p);
      setAnalysis(a);
      setNeedPw(false);
    } catch (e) {
      if (e instanceof AppError && e.code === 'password_required') setNeedPw(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    reset();
    setDone(null);
    try {
      const f = await pickTextFile();
      if (!f) return;
      setFile(f);
      await read(f);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const restore = async () => {
    if (!parsed || !analysis) return;
    if (analysis.currentHasData) {
      const ok = await confirmAction({
        title: 'Reemplazar todos los datos',
        danger: true,
        message: (
          <>
            <p>Los datos actuales de este dispositivo se reemplazarán por los del respaldo. Se guardará una copia interna para poder deshacerlo.</p>
            <p className="small">Esto no sincroniza los teléfonos: después de importar, cada uno seguirá cambiando por separado.</p>
          </>
        ),
        input: { label: 'Escribe REEMPLAZAR para confirmar', required: true, mustEqual: 'REEMPLAZAR' },
        confirmText: 'Reemplazar datos',
      });
      if (!ok) return;
    }
    const r = await act.run(() => restoreBackup(db, parsed, { allowIntegrityWarnings: force, safetyName }));
    if (r) {
      setDone(`Restauración completa: ${r.counts.inventories} inventario(s), ${r.counts.units} unidad(es), ${r.counts.sales} venta(s). Verificación de integridad: ${r.integrity.ok ? 'correcta' : `${r.integrity.issues.length} aviso(s)`}.`);
      reset();
      toast('Respaldo restaurado');
    }
  };

  const exportCurrent = async () => {
    const r = await act.run(() => createBackup(db));
    if (r) {
      const outcome = await shareFile(r.filename, r.text).catch(() => 'cancelled' as const);
      if (outcome !== 'cancelled') await markBackupDone(db, r.createdAt);
    }
  };

  return (
    <Card title="Importar / restaurar respaldo">
      <div className="stack">
        <p className="small">Abre un archivo de respaldo de esta app (de este u otro teléfono, iPhone o Android). Antes de importar verás un resumen. Si el archivo está dañado, no se modifica nada.</p>
        <button className="btn block" onClick={() => void choose()} disabled={busy || act.busy} data-testid="choose-backup">
          <Icon name="upload" /> Elegir archivo de respaldo
        </button>
        {busy ? <Loading label="Leyendo y verificando el archivo…" /> : null}
        {error ? (
          <Notice kind="bad" title="No se puede importar este archivo">
            {error} Tus datos actuales no se modificaron.
          </Notice>
        ) : null}
        {needPw && file ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void read(file, pw);
            }}
          >
            <Field label="Contraseña del respaldo" htmlFor="im-pw">
              <TextInput id="im-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus />
            </Field>
            <button className="btn primary block" disabled={!pw || busy}>
              Abrir respaldo
            </button>
          </form>
        ) : null}
        {parsed && analysis ? (
          <div className="stack" data-testid="import-summary">
            <h3>Resumen del respaldo</h3>
            <KV
              rows={[
                ['Archivo', <span key="f" className="wrap-anywhere">{file?.name}</span>],
                ['Creado', formatDateTime(parsed.createdAt)],
                ['Versión de la app', parsed.appVersion],
                ['Protegido con contraseña', parsed.encrypted ? 'Sí' : 'No'],
                ['Origen', analysis.sameInstallation ? 'Este mismo dispositivo' : 'Otra instalación'],
                ...SUMMARY_TABLES.map((t) => [TABLE_LABEL[t] ?? t, formatInt(parsed.counts[t] ?? 0)] as [string, string]),
              ]}
            />
            {parsed.migratedFrom ? <Notice>El respaldo es de una versión anterior de los datos y se convirtió automáticamente.</Notice> : null}
            {analysis.integrity.ok ? (
              <Notice kind="ok" title="Verificación de integridad correcta">
                Relaciones, existencias y totales del respaldo son coherentes.
              </Notice>
            ) : (
              <Notice kind="bad" title={`El respaldo tiene ${analysis.integrity.issues.length} inconsistencia(s)`}>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {analysis.integrity.issues.slice(0, 5).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <label className="check">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Entiendo el riesgo: restaurar de todas formas
                </label>
              </Notice>
            )}
            {analysis.alreadyRestored ? <Notice>Este mismo respaldo ya fue restaurado y no hay cambios posteriores.</Notice> : null}
            {analysis.currentHasData ? (
              <Notice kind="warn" title="Este dispositivo ya tiene datos">
                <p>
                  Actualmente hay {analysis.currentCounts.inventories} inventario(s), {analysis.currentCounts.units + analysis.currentCounts.products} producto(s)/unidad(es) y {analysis.currentCounts.sales} venta(s). Importar los <strong>reemplazará</strong>.
                </p>
                {analysis.olderThanCurrent ? <p style={{ marginTop: 6 }}>⚠ El respaldo es más antiguo que tus últimos cambios: se perderá lo registrado después de {formatDateTime(parsed.createdAt)}.</p> : null}
                <p style={{ marginTop: 6 }}>
                  Combinar dos instalaciones no está disponible: sus códigos internos y registros podrían chocar y duplicar existencias o dinero. Para proteger los datos, la importación siempre reemplaza todo (con copia interna para deshacer).
                </p>
              </Notice>
            ) : (
              <Notice>Este dispositivo no tiene datos: se restaurará el respaldo completo.</Notice>
            )}
            <div className="stack-sm">
              {analysis.currentHasData ? (
                <button className="btn block" onClick={() => void exportCurrent()} disabled={act.busy}>
                  <Icon name="download" /> Primero, respaldar mis datos actuales
                </button>
              ) : null}
              <button className={`btn block ${analysis.currentHasData ? 'danger' : 'primary'}`} disabled={act.busy || (!analysis.integrity.ok && !force)} onClick={() => void restore()} data-testid="restore-backup">
                {act.busy ? 'Restaurando…' : analysis.currentHasData ? 'Reemplazar mis datos con este respaldo' : 'Restaurar respaldo'}
              </button>
              <button className="btn block" onClick={reset} disabled={act.busy}>
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
        <FormError error={act.error} />
        {done ? (
          <Notice kind="ok" title="Listo">
            <span data-testid="restore-done">{done}</span>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}

function UndoCard({ createdAt }: { createdAt: string }) {
  const act = useAction();
  return (
    <Card title="Deshacer la última restauración">
      <div className="stack">
        <p className="small">
          Antes de restaurar se guardó una copia interna de los datos que había ({formatDateTime(createdAt)}). <Badge>Copia interna</Badge>
        </p>
        <button
          className="btn block"
          disabled={act.busy}
          onClick={async () => {
            const ok = await confirmAction({ title: 'Deshacer restauración', message: 'Se volverá a los datos que había antes de la última restauración.', confirmText: 'Deshacer', danger: true });
            if (ok) await act.run(() => undoLastRestore(db, safetyName), 'Se recuperaron los datos anteriores');
          }}
        >
          <Icon name="undo" /> Volver a los datos anteriores
        </button>
        <FormError error={act.error} />
      </div>
    </Card>
  );
}
