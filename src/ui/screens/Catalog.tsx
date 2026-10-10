import { useMemo, useState } from 'react';
import { addCatalogModel, KIND_LABEL, normalizeText, updateCatalogModel, type CatalogModel, type ProductKind } from '../../core';
import { Icon } from '../components/Icon';
import { Badge, Card, Chips, Empty, Field, FormError, IntInput, Loading, Page, Segmented, Sheet, TextInput } from '../components/ui';
import { db, useAction, useLive } from '../store';

export function CatalogScreen() {
  const models = useLive((d) => d.catalogModels.toArray());
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | ProductKind>('phone');
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<CatalogModel | 'new' | null>(null);
  const list = useMemo(() => {
    const nq = normalizeText(q);
    return (models ?? [])
      .filter((m) => (cat === 'all' || m.category === cat) && (showHidden || !m.archived) && (!nq || normalizeText(`${m.brand} ${m.model} ${m.generation}`).includes(nq)))
      .sort((a, b) => a.brand.localeCompare(b.brand) || (a.year ?? 0) - (b.year ?? 0) || a.model.localeCompare(b.model, 'es', { numeric: true }));
  }, [models, q, cat, showHidden]);
  return (
    <Page
      title="Catálogo de modelos"
      back="/mas"
      actions={
        <button className="icon-btn" aria-label="Agregar modelo" onClick={() => setEditing('new')}>
          <Icon name="plus" />
        </button>
      }
    >
      <p className="small muted">
        Lista de referencia para crear productos más rápido. Incluye iPhone desde el X hasta los modelos anunciados en septiembre de 2026 y AirPods. Puede agregar marcas y modelos (Android u otros). El modelo nunca identifica a una unidad física: cada unidad tiene su propio código.
      </p>
      <TextInput type="search" placeholder="Buscar modelo" aria-label="Buscar modelo" value={q} onChange={(e) => setQ(e.target.value)} />
      <Chips label="Categoría" value={cat} onChange={setCat} options={[['phone', 'Teléfonos'], ['audio', 'Audífonos'], ['accessory', 'Accesorios'], ['other', 'Otros'], ['all', 'Todos']]} />
      <Card flush>
        {!models ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="book" title="Sin modelos" />
        ) : (
          <ul className="list">
            {list.map((m) => (
              <li key={m.id}>
                <button className="item" onClick={() => setEditing(m)}>
                  <span className="item-main">
                    <span className="item-title" style={{ display: 'block' }}>
                      {m.brand} {m.model}
                    </span>
                    <span className="item-sub" style={{ display: 'block' }}>
                      {[m.year, m.storageOptions.join(', '), m.biometric === 'touchid' ? 'Touch ID' : m.biometric === 'faceid' ? 'Face ID' : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="item-side">{m.archived ? <Badge>Oculto</Badge> : m.builtin ? null : <Badge kind="info">Agregado</Badge>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <label className="check">
        <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Mostrar modelos ocultos
      </label>
      {editing ? <ModelSheet model={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

function ModelSheet({ model, onClose }: { model: CatalogModel | null; onClose: () => void }) {
  const [category, setCategory] = useState<ProductKind>(model?.category ?? 'phone');
  const [brand, setBrand] = useState(model?.brand ?? '');
  const [name, setName] = useState(model?.model ?? '');
  const [generation, setGeneration] = useState(model?.generation ?? '');
  const [year, setYear] = useState<number | null>(model?.year ?? null);
  const [storage, setStorage] = useState((model?.storageOptions ?? []).join(', '));
  const act = useAction();
  const builtin = !!model?.builtin;
  const options = storage.split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <Sheet
      title={model ? `${model.brand} ${model.model}` : 'Agregar modelo'}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary block"
            disabled={act.busy}
            onClick={async () => {
              const ok = await act.run(
                () =>
                  (model
                    ? updateCatalogModel(db, model.id, { brand, model: name, generation, year, storageOptions: options })
                    : addCatalogModel(db, { category, brand, model: name, generation, year, storageOptions: options })
                  ).then(() => true),
                'Catálogo actualizado',
              );
              if (ok) onClose();
            }}
          >
            Guardar
          </button>
          {model ? (
            <button className="btn block" onClick={async () => { const ok = await act.run(() => updateCatalogModel(db, model.id, { archived: !model.archived }).then(() => true), model.archived ? 'Modelo visible' : 'Modelo oculto'); if (ok) onClose(); }}>
              {model.archived ? 'Mostrar en listas' : 'Ocultar de las listas'}
            </button>
          ) : null}
        </>
      }
    >
      {!model ? (
        <Field label="Categoría">
          <Segmented label="Categoría" value={category} onChange={setCategory} options={(['phone', 'audio', 'accessory', 'other'] as ProductKind[]).map((k) => [k, KIND_LABEL[k]])} />
        </Field>
      ) : null}
      <div className="grid-2">
        <Field label="Marca" htmlFor="cm-brand" error={act.field === 'brand' ? act.error : null}>
          <TextInput id="cm-brand" value={brand} disabled={builtin} onChange={(e) => setBrand(e.target.value)} placeholder="Ej.: Samsung" />
        </Field>
        <Field label="Modelo" htmlFor="cm-model" error={act.field === 'model' ? act.error : null}>
          <TextInput id="cm-model" value={name} disabled={builtin} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Galaxy S24" />
        </Field>
        <Field label="Generación / familia" htmlFor="cm-gen">
          <TextInput id="cm-gen" value={generation} disabled={builtin} onChange={(e) => setGeneration(e.target.value)} />
        </Field>
        <Field label="Año" htmlFor="cm-year">
          <IntInput id="cm-year" value={year} onChange={setYear} />
        </Field>
      </div>
      <Field label="Capacidades (separadas por comas)" htmlFor="cm-st" hint="Ej.: 128 GB, 256 GB">
        <TextInput id="cm-st" value={storage} onChange={(e) => setStorage(e.target.value)} />
      </Field>
      {builtin ? <p className="small muted">Los modelos base no se pueden renombrar; puede ocultarlos o ajustar sus capacidades.</p> : null}
      <FormError error={act.field === 'brand' || act.field === 'model' ? null : act.error} />
    </Sheet>
  );
}
