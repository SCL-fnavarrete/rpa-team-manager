import React from 'react';
import { Card, Typography, Tag, Space, Divider, Alert, Button, Spin, theme } from 'antd';
import { 
  CheckCircleOutlined, 
  WarningOutlined, 
  CloseCircleOutlined, 
  ClockCircleOutlined,
  CalendarOutlined,
  FileDoneOutlined,
  RiseOutlined,
  LockOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import { ScopingCalculationResult } from '../../types/scoping';

const { Text, Title } = Typography;

interface LiveScoringSidebarProps {
  calculation: ScopingCalculationResult | null;
  loading?: boolean;
  // Mensaje del servidor cuando el cálculo falló; el panel no muestra números en ese caso
  error?: string | null;
  onOpenProposal: () => void;
  onSaveQuote: () => void;
  isSaving?: boolean;
}

export const LiveScoringSidebar: React.FC<LiveScoringSidebarProps> = ({
  calculation,
  loading = false,
  error = null,
  onOpenProposal,
  onSaveQuote,
  isSaving = false
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  if (error || !calculation) {
    return (
      <Card 
        styles={{ body: { padding: 20 } }}
        aria-busy={loading}
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
        }}
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            message="No se pudo calcular la estimación"
            description={error}
          />
        ) : loading ? (
          <Space size={8}>
            <Spin size="small" />
            <Text type="secondary">Calculando…</Text>
          </Space>
        ) : (
          <Text type="secondary">Completa las variables del levantamiento para visualizar la estimación en tiempo real.</Text>
        )}
      </Card>
    );
  }

  // Configuración visual según Viabilidad
  const viabilityConfig: Record<string, { color: string; icon: React.ReactNode; type: 'success' | 'warning' | 'info' | 'error' }> = {
    viable: { color: 'success', icon: <CheckCircleOutlined />, type: 'success' },
    digitize_first: { color: 'warning', icon: <WarningOutlined />, type: 'warning' },
    postpone: { color: 'processing', icon: <ClockCircleOutlined />, type: 'info' },
    low_viability: { color: 'error', icon: <CloseCircleOutlined />, type: 'error' },
    not_viable: { color: 'error', icon: <CloseCircleOutlined />, type: 'error' }
  };

  const currentViability = viabilityConfig[calculation.viability_status] || viabilityConfig.viable;

  // Configuración de Esfuerzo
  const effortConfig: Record<string, { label: string; color: string }> = {
    low: { label: 'Bajo Esfuerzo (~5 semanas)', color: 'cyan' },
    medium: { label: 'Mediano Esfuerzo (~8 semanas)', color: 'orange' },
    high: { label: 'Alto Esfuerzo (~10 semanas)', color: 'red' }
  };
  const currentEffort = effortConfig[calculation.effort_level] || effortConfig.medium;

  const formatCurrency = (val: number, cur: string) => {
    return `${cur} ${val.toLocaleString('es-CL')}`;
  };

  return (
    <Card 
      styles={{ body: { padding: '18px 20px' } }}
      aria-busy={loading}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer,
        position: 'sticky',
        top: 24
      }}
    >
      {/* 1. Header con Badge de Viabilidad */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Diagnóstico de Factibilidad RPA
          </Text>
          {loading && (
            <Space size={6}>
              <Spin size="small" />
              <Text type="secondary" style={{ fontSize: 12 }}>Calculando…</Text>
            </Space>
          )}
        </div>
        <div style={{ marginTop: 4 }}>
          <Alert 
            type={currentViability.type}
            showIcon
            icon={currentViability.icon}
            message={<Text strong>{calculation.viability_label}</Text>}
            description={
              calculation.blockers.length > 0 ? (
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 12 }}>
                  {calculation.blockers.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Cumple con los requisitos base de reglas y digitalización para automatización.
                </Text>
              )
            }
          />
        </div>
      </div>

      {/* 2. Multiplicadores técnicos activos */}
      {(calculation.vdi_multiplier > 1.0 || calculation.ocr_multiplier > 1.0) && (
        <div style={{ 
          marginBottom: 14, 
          padding: '8px 12px', 
          borderRadius: 6,
          backgroundColor: isDark ? 'rgba(250, 140, 22, 0.12)' : '#fff7e6',
          border: `1px dashed ${token.colorWarning}`
        }}>
          <Text strong style={{ fontSize: 12, color: token.colorWarning }}>
            Factores Multiplicadores Detectados:
          </Text>
          <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {calculation.vdi_multiplier > 1.0 && (
              <Tag color="volcano" icon={<LockOutlined />}>
                VDI / Citrix: +60% esfuerzo
              </Tag>
            )}
            {calculation.ocr_multiplier > 1.0 && (
              <Tag color="purple" icon={<FilePdfOutlined />}>
                OCR / Escaneados: +20% esfuerzo
              </Tag>
            )}
          </div>
        </div>
      )}

      {/* 3. Cubicación de Esfuerzo & Horas */}
      <div style={{ 
        padding: '12px 14px', 
        borderRadius: 8,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 14
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Cubicación Total</Text>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <Title level={2} style={{ margin: 0, color: token.colorPrimary }}>
                {calculation.total_hours}
              </Title>
              <Text strong>HH</Text>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Tag color={currentEffort.color}>{calculation.effort_label}</Tag>
            <div style={{ marginTop: 4 }}>
              <Space size={4}>
                <CalendarOutlined style={{ color: token.colorTextSecondary }} />
                <Text strong>{calculation.estimated_weeks} Semanas</Text>
              </Space>
            </div>
          </div>
        </div>

        <Divider style={{ margin: '10px 0' }} />

        {/* Desglose por roles */}
        <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
          Equipo Requerido:
        </Text>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {calculation.roles_breakdown.map((r) => (
            <div key={r.role_code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <Text type="secondary">{r.role_name}:</Text>
              <Text strong>{r.total_hours} HH ({r.fte_equivalent} FTE)</Text>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Propuesta Comercial & ROI para el Cliente */}
      <div style={{ 
        padding: '12px 14px', 
        borderRadius: 8,
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Precio Sugerido Venta</Text>
          <Text strong style={{ fontSize: 16, color: token.colorSuccess }}>
            {formatCurrency(calculation.proposed_price, calculation.currency)}
          </Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
          <Text type="secondary">Tarifa venta aplicada:</Text>
          <Text>{formatCurrency(calculation.target_hourly_rate, calculation.currency)}/h</Text>
        </div>
        {calculation.projected_margin_pct !== undefined && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
            <Text type="secondary">Margen estimado:</Text>
            <Text strong style={{ color: token.colorSuccess }}>{calculation.projected_margin_pct}%</Text>
          </div>
        )}

        <Divider style={{ margin: '10px 0' }} />

        {/* Retorno para el Cliente */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space size={4}>
            <RiseOutlined style={{ color: token.colorWarning }} />
            <Text strong style={{ fontSize: 12 }}>Ahorro Anual Cliente:</Text>
          </Space>
          <Text strong style={{ color: token.colorWarning }}>
            {formatCurrency(calculation.client_annual_savings, calculation.currency)}
          </Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
          <Text type="secondary">Horas manuales liberadas:</Text>
          <Text strong>{calculation.hours_saved_annual.toLocaleString()} h/año</Text>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
          <Text type="secondary">Retorno de inversión (Payback):</Text>
          <Text strong style={{ color: token.colorPrimary }}>
            {calculation.payback_months > 0 ? `${calculation.payback_months} meses` : 'Inmediato'}
          </Text>
        </div>
      </div>

      {/* Botones de acción principales */}
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Button 
          type="primary" 
          block 
          size="large"
          icon={<FileDoneOutlined />}
          onClick={onOpenProposal}
        >
          Ver Propuesta Técnico-Económica
        </Button>
        <Button 
          block 
          loading={isSaving}
          onClick={onSaveQuote}
        >
          Guardar Cotización
        </Button>
      </Space>
    </Card>
  );
};
