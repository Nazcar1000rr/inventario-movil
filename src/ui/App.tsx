import { useState, type ReactNode } from 'react';
import { Icon } from './components/Icon';
import { AskHost, ErrorBoundary, Sheet, ToastHost } from './components/ui';
import { navigate, useRoute } from './router';
import { BackupScreen } from './screens/Backup';
import { CatalogScreen } from './screens/Catalog';
import { HomeScreen } from './screens/Home';
import { HistoryScreen, InventoriesScreen, InventoryDetailScreen } from './screens/Inventories';
import { ExpenseDetailScreen, ExpenseFormScreen, OperationsScreen } from './screens/Operations';
import { PartiesScreen, PartyDetailScreen } from './screens/Parties';
import { ProductDetailScreen, ProductFormScreen, StockEntryScreen } from './screens/Products';
import { PurchaseDetailScreen, PurchaseFormScreen } from './screens/Purchases';
import { ReportsScreen } from './screens/Reports';
import { SaleDetailScreen, SaleFormScreen } from './screens/Sales';
import { MoreScreen, SearchScreen, SettingsScreen } from './screens/Settings';
import { UnitDetailScreen } from './screens/Unit';
import { ViewDetailScreen, ViewsScreen } from './screens/Views';
import { WarrantiesScreen, WarrantyDetailScreen } from './screens/Warranties';

function resolve(seg: string[], q: URLSearchParams): ReactNode {
  const [a, b, c] = seg;
  switch (a) {
    case undefined:
      return <HomeScreen />;
    case 'inventarios':
      return b ? <InventoryDetailScreen id={b} /> : <InventoriesScreen />;
    case 'historial':
      return <HistoryScreen inventoryId={q.get('inv')} />;
    case 'productos':
      if (b === 'nuevo') return <ProductFormScreen inventoryId={q.get('inv')} />;
      if (b && c === 'editar') return <ProductFormScreen productId={b} />;
      return b ? <ProductDetailScreen id={b} /> : null;
    case 'unidades':
      return b ? <UnitDetailScreen id={b} /> : null;
    case 'stock':
      return <StockEntryScreen inventoryId={q.get('inv')} productId={q.get('product')} />;
    case 'compras':
      if (b === 'nueva') return <PurchaseFormScreen inventoryId={q.get('inv')} productId={q.get('product')} />;
      return b ? <PurchaseDetailScreen id={b} /> : <OperationsScreen tab="compras" />;
    case 'ventas':
      if (b === 'nueva') return <SaleFormScreen inventoryId={q.get('inv')} productId={q.get('product')} unitId={q.get('unit')} />;
      return b ? <SaleDetailScreen id={b} /> : <OperationsScreen tab="ventas" />;
    case 'operaciones':
      return <OperationsScreen tab={(q.get('tab') as 'ventas' | 'compras' | 'gastos') ?? 'ventas'} />;
    case 'gastos':
      if (b === 'nuevo') return <ExpenseFormScreen inventoryId={q.get('inv')} />;
      return b ? <ExpenseDetailScreen id={b} /> : <OperationsScreen tab="gastos" />;
    case 'proveedores':
      return b ? <PartyDetailScreen type="supplier" id={b} /> : <PartiesScreen type="supplier" />;
    case 'compradores':
      return b ? <PartyDetailScreen type="customer" id={b} /> : <PartiesScreen type="customer" />;
    case 'garantias':
      return b ? <WarrantyDetailScreen id={b} /> : <WarrantiesScreen />;
    case 'informes':
      return <ReportsScreen />;
    case 'vistas':
      return b ? <ViewDetailScreen id={b} /> : <ViewsScreen />;
    case 'catalogo':
      return <CatalogScreen />;
    case 'respaldo':
      return <BackupScreen />;
    case 'ajustes':
      return <SettingsScreen />;
    case 'mas':
      return <MoreScreen />;
    case 'buscar':
      return <SearchScreen />;
  }
  return null;
}

const NAV: { href: string; label: string; icon: string; match: (s: string[]) => boolean }[] = [
  { href: '/', label: 'Inicio', icon: 'home', match: (s) => s.length === 0 },
  { href: '/inventarios', label: 'Inventarios', icon: 'box', match: (s) => ['inventarios', 'productos', 'unidades', 'stock', 'historial'].includes(s[0]) },
  { href: '/operaciones', label: 'Operaciones', icon: 'list', match: (s) => ['operaciones', 'ventas', 'compras', 'gastos'].includes(s[0]) },
  { href: '/mas', label: 'Más', icon: 'menu', match: (s) => !['', 'inventarios', 'productos', 'unidades', 'stock', 'historial', 'operaciones', 'ventas', 'compras', 'gastos'].includes(s[0] ?? '') },
];

const SIDE: { href: string; label: string; icon: string; key: string }[] = [
  { href: '/', label: 'Inicio', icon: 'home', key: '' },
  { href: '/inventarios', label: 'Inventarios', icon: 'box', key: 'inventarios' },
  { href: '/operaciones?tab=ventas', label: 'Ventas', icon: 'tag', key: 'ventas' },
  { href: '/operaciones?tab=compras', label: 'Compras', icon: 'cart', key: 'compras' },
  { href: '/operaciones?tab=gastos', label: 'Gastos', icon: 'receipt', key: 'gastos' },
  { href: '/informes', label: 'Informes', icon: 'chart', key: 'informes' },
  { href: '/garantias', label: 'Garantías', icon: 'shield', key: 'garantias' },
  { href: '/proveedores', label: 'Proveedores', icon: 'truck', key: 'proveedores' },
  { href: '/compradores', label: 'Compradores', icon: 'users', key: 'compradores' },
  { href: '/vistas', label: 'Vistas consolidadas', icon: 'layers', key: 'vistas' },
  { href: '/catalogo', label: 'Catálogo', icon: 'book', key: 'catalogo' },
  { href: '/buscar', label: 'Buscar', icon: 'search', key: 'buscar' },
  { href: '/respaldo', label: 'Respaldo', icon: 'download', key: 'respaldo' },
  { href: '/ajustes', label: 'Configuración', icon: 'sliders', key: 'ajustes' },
];

export const QUICK_ACTIONS: { href: string; label: string; icon: string; hint: string }[] = [
  { href: '/ventas/nueva', label: 'Registrar venta', icon: 'tag', hint: 'Sale del inventario y suma ingresos' },
  { href: '/compras/nueva', label: 'Registrar compra', icon: 'cart', hint: 'Entra al inventario con su costo' },
  { href: '/gastos/nuevo', label: 'Registrar gasto', icon: 'receipt', hint: 'Transporte, publicidad, empaques…' },
  { href: '/stock/nuevo', label: 'Ingresar stock existente', icon: 'box', hint: 'Mercancía que ya tenía (no es una compra nueva)' },
  { href: '/productos/nuevo', label: 'Crear producto', icon: 'plus', hint: 'Sin registrar existencias todavía' },
];

export function App() {
  const route = useRoute();
  const [quick, setQuick] = useState(false);
  const seg = route.segments;
  const sideKey = seg[0] === 'operaciones' ? route.query.get('tab') ?? 'ventas' : seg[0] ?? '';
  return (
    <div className="app">
      <nav className="side-nav" aria-label="Secciones">
        <div className="brand">Inventario Móvil</div>
        <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => setQuick(true)}>
          <Icon name="plus" /> Registrar
        </button>
        {SIDE.map((n) => (
          <a key={n.href} href={`#${n.href}`} aria-current={sideKey === n.key ? 'page' : undefined}>
            <Icon name={n.icon} size={20} /> {n.label}
          </a>
        ))}
      </nav>
      <main className="main" id="main">
        <ErrorBoundary resetKey={route.path + route.query.toString()}>
          {resolve(seg, route.query) ?? (
            <div className="content">
              <p>Pantalla no encontrada.</p>
              <a className="btn" href="#/">
                Ir al inicio
              </a>
            </div>
          )}
        </ErrorBoundary>
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        {NAV.slice(0, 2).map((n) => (
          <a key={n.href} className="nav-item" href={`#${n.href}`} aria-current={n.match(seg) ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
        <button className="nav-item" aria-label="Registrar operación" onClick={() => setQuick(true)}>
          <span className="nav-plus">
            <Icon name="plus" />
          </span>
        </button>
        {NAV.slice(2).map((n) => (
          <a key={n.href} className="nav-item" href={`#${n.href}`} aria-current={n.match(seg) ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      {quick ? (
        <Sheet title="Registrar" onClose={() => setQuick(false)}>
          <div className="stack-sm">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.href}
                className="menu-item"
                onClick={() => {
                  setQuick(false);
                  navigate(a.href);
                }}
              >
                <Icon name={a.icon} />
                <span className="grow">
                  <span className="strong" style={{ display: 'block' }}>
                    {a.label}
                  </span>
                  <span className="small muted">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
      <AskHost />
      <ToastHost />
    </div>
  );
}
