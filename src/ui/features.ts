import { featureOn, getBusinessProfile, type BusinessProfile, type FeatureKey } from '../core';
import type { MenuGroup, QuickGroup } from './menu';
import { useLive } from './store';

/** Perfil del negocio (tipos elegidos y funciones). undefined mientras carga. */
export function useBusiness(): BusinessProfile | undefined {
  return useLive((d) => getBusinessProfile(d), []);
}

/** ¿Está activa esta función? Mientras carga se muestra todo (no parpadea al abrir). */
export function useFeature(key: FeatureKey): boolean {
  const p = useBusiness();
  return p ? featureOn(p, key) : true;
}

export function visibleMore(groups: MenuGroup[], p: BusinessProfile | undefined): MenuGroup[] {
  if (!p) return groups;
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.feature || featureOn(p, i.feature)) })).filter((g) => g.items.length);
}

export function visibleQuick(groups: QuickGroup[], p: BusinessProfile | undefined): QuickGroup[] {
  if (!p) return groups;
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.feature || featureOn(p, i.feature)) })).filter((g) => g.items.length);
}
