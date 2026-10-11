import { useState, type ReactNode } from 'react';
import { Icon } from './components/Icon';
import { AskHost, ErrorBoundary, Sheet, ToastHost } from './components/ui';
import { navigate, useRoute } from './router';
import { practice } from './store';
import { TourHost } from './tour';
import { SpeechBar } from './components/speechbar';
import { MORE_GROUPS, QUICK_GROUPS } from './menu';
import { MemosScreen } from './screens/Memos';
import { BackupScreen } from './screens/Backup';
import { CapitalScreen } from './screens/Capital';
import { DebtDetailScreen, DebtsScreen } from './screens/Debts';
import { HelpArticleScreen, HelpScreen, NewsHost, PracticeBanner } from './screens/Help';
import { CalculatorScreen, MarketPricesScreen } from './screens/Pricing';
import { SummaryScreen } from './screens/Summary';
import { PersonalScreen } from './screens/Personal';
import { LearnScreen, LessonScreen } from './screens/Learn';
import { AppearanceScreen } from './screens/Appearance';
import { AnalysisScreen } from './screens/Analysis';
import { InquiriesScreen } from './screens/Inquiries';
import { CalendarScreen } from './screens/Calendar';
import { DebtorScreen, DebtorsScreen } from './screens/Debtors';
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
      if (b === 'nueva') return <SaleFormScreen key={q.get('fiado') ?? ''} inventoryId={q.get('inv')} productId={q.get('product')} unitId={q.get('unit')} fiado={q.get('fiado') === '1'} customer={q.get('cliente')} />;
      return b ? <SaleDetailScreen id={b} /> : <OperationsScreen tab="ventas" />;
    case 'operaciones':
      return <OperationsScreen tab={(q.get('tab') as 'ventas' | 'compras' | 'gastos') ?? 'ventas'} />;
    case 'gastos':
      if (b === 'nuevo') return <ExpenseFormScreen key={q.get('tipo') ?? ''} inventoryId={q.get('inv')} kind={q.get('tipo')} />;
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
    case 'capital':
      return <CapitalScreen />;
    case 'deudas':
      return b ? <DebtDetailScreen id={b} /> : <DebtsScreen />;
    case 'precios':
      return <MarketPricesScreen />;
    case 'calculadora':
      return <CalculatorScreen />;
    case 'resumen':
      return <SummaryScreen />;
    case 'ayuda':
      return b ? <HelpArticleScreen id={b} /> : <HelpScreen />;
    case 'personal':
      return <PersonalScreen />;
    case 'apariencia':
      return <AppearanceScreen />;
    case 'aprende':
      return b ? <LessonScreen id={b} /> : <LearnScreen />;
    case 'analisis':
      return <AnalysisScreen />;
    case 'preguntones':
      return <InquiriesScreen />;
    case 'calendario':
      return <CalendarScreen />;
    case 'me-deben':
      return b ? <DebtorScreen key={b} debtorKey={b} /> : <DebtorsScreen />;
    case 'notas':
      return <MemosScreen />;
  }
  return null;
}

const NAV: { href: string; label: string; icon: string; match: (s: string[]) => boolean }[] = [
  { href: '/', label: 'Inicio', icon: 'home', match: (s) => s.length === 0 },
  { href: '/inventarios', label: 'Inventarios', icon: 'box', match: (s) => ['inventarios', 'productos', 'unidades', 'stock', 'historial'].includes(s[0]) },
  { href: '/operaciones', label: 'Operaciones', icon: 'list', match: (s) => ['operaciones', 'ventas', 'compras', 'gastos'].includes(s[0]) },
  { href: '/mas', label: 'Más', icon: 'menu', match: (s) => !['', 'inventarios', 'productos', 'unidades', 'stock', 'historial', 'operaciones', 'ventas', 'compras', 'gastos'].includes(s[0] ?? '') },
];

/** Barra lateral (tableta o computador): lo principal arriba y el resto por categorías, como en Más. */
const SIDE_MAIN: { href: string; label: string; icon: string; key: string }[] = [
  { href: '/', label: 'Inicio', icon: 'home', key: '' },
  { href: '/inventarios', label: 'Inventarios', icon: 'box', key: 'inventarios' },
  { href: '/operaciones?tab=ventas', label: 'Ventas', icon: 'tag', key: 'ventas' },
  { href: '/operaciones?tab=compras', label: 'Compras', icon: 'cart', key: 'compras' },
  { href: '/operaciones?tab=gastos', label: 'Gastos', icon: 'receipt', key: 'gastos' },
];

export function App() {
  const route = useRoute();
  const [quick, setQuick] = useState(false);
  const seg = route.segments;
  const sideKey = seg[0] === 'operaciones' ? route.query.get('tab') ?? 'ventas' : seg[0] ?? '';
  return (
    <div className={`app${practice ? ' practice' : ''}`}>
      <PracticeBanner />
      <nav className="side-nav" aria-label="Secciones">
        <div className="brand">
          <img src="./icons/icon.svg" alt="" width="30" height="30" className="brand-logo" /> Inventario Móvil
        </div>
        <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => setQuick(true)} data-tour="quick">
          <Icon name="plus" /> Registrar
        </button>
        {SIDE_MAIN.map((n) => (
          <a key={n.href} href={`#${n.href}`} aria-current={sideKey === n.key ? 'page' : undefined} data-tour={n.key === 'inventarios' ? 'nav-inventarios' : n.key === 'ventas' ? 'nav-operaciones' : undefined}>
            <Icon name={n.icon} size={20} /> {n.label}
          </a>
        ))}
        {MORE_GROUPS.map((g, gi) => (
          <div key={g.title} className="side-group" data-tour={gi === 0 ? 'nav-mas' : undefined}>
            <p className="side-title">{g.title}</p>
            {g.items.map((n) => (
              <a key={n.href} href={`#${n.href}`} aria-current={sideKey === n.key ? 'page' : undefined}>
                <Icon name={n.icon} size={20} /> {n.label}
              </a>
            ))}
          </div>
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
          <a key={n.href} className="nav-item" href={`#${n.href}`} aria-current={n.match(seg) ? 'page' : undefined} data-tour={`nav-${n.href.slice(1) || 'inicio'}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
        <button className="nav-item" aria-label="Registrar operación" onClick={() => setQuick(true)} data-tour="quick">
          <span className="nav-plus">
            <Icon name="plus" />
          </span>
        </button>
        {NAV.slice(2).map((n) => (
          <a key={n.href} className="nav-item" href={`#${n.href}`} aria-current={n.match(seg) ? 'page' : undefined} data-tour={`nav-${n.href.slice(1)}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      {quick ? (
        <Sheet title="Registrar" onClose={() => setQuick(false)}>
          <div className="quick-groups" data-testid="quick-menu">
            {QUICK_GROUPS.map((g) => (
              <section key={g.title} className="quick-group" aria-label={g.title}>
                <h3 className="quick-title">{g.title}</h3>
                <div className="quick-grid">
                  {g.items.map((a) => (
                    <button
                      key={a.href}
                      type="button"
                      className="quick-tile"
                      title={a.hint}
                      onClick={() => {
                        setQuick(false);
                        navigate(a.href);
                      }}
                    >
                      <span className="quick-icon" aria-hidden="true">
                        <Icon name={a.icon} size={20} />
                      </span>
                      <span className="quick-label">{a.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Sheet>
      ) : null}
      <NewsHost />
      <TourHost />
      <SpeechBar />
      <AskHost />
      <ToastHost />
    </div>
  );
}
