/**
 * Estado de campaña frente al informe Quividi (espejo de la matriz de
 * `src/modules/campaigns/campaignStatus.ts`). Las campañas canceladas,
 * duplicadas o retiradas del calendario no generan informe; en pausa sí.
 * Se valida también en el servidor: ocultar el botón no es control.
 */
export function quividiBlockedReason(
  campaign: { active?: unknown },
  tracking: { lifecycleStatus?: unknown } | undefined,
): string | null {
  if (campaign.active === false) {
    return 'La campaña fue retirada del calendario: no genera informe Quividi.';
  }
  if (tracking?.lifecycleStatus === 'cancelled') {
    return 'La campaña está cancelada: no genera informe Quividi.';
  }
  if (tracking?.lifecycleStatus === 'duplicate') {
    return 'La campaña está marcada como duplicada: no genera informe Quividi.';
  }
  return null;
}
