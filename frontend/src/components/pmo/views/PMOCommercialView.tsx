import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Button, Space, Alert, theme } from 'antd';
import {
  DollarOutlined,
  WarningOutlined,
  RiseOutlined,
  ExclamationCircleOutlined,
  SmileOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PMOCommercialData } from '@/types/pmo';
import { LoadingState, EmptyState } from '@/components/common/FeedbackStates';
import { formatCLP, formatPercent } from '@/utils';

const { Text } = Typography;

interface PMOCommercialViewProps {
  data: PMOCommercialData | null;
  loading?: boolean;
}

export const PMOCommercialView: React.FC<PMOCommercialViewProps> = ({
  data,
  loading = false
}) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();

  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  if (loading) {
    return <LoadingState tip="Cargando perspectiva Comercial..." minHeight={320} />;
  }

  if (!data) {
    return (
      <EmptyState
        description="No hay información ejecutiva disponible para la perspectiva Comercial."
      />
    );
  }

  const {
    ready_to_invoice,
    total_unlocked_revenue_clp,
    margin_variance,
    scope_creep_alerts,
    client_scorecards
  } = data;

  const billableColumns = [
    {
      title: 'Proyecto & Cliente',
      key: 'project',
      render: (_: unknown, record: any) => (
        <div>
          <Button
            type="link"
            style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }}
            onClick={() => navigate(`/projects/${record.project_id}`)}
          >
            {record.project_name}
          </Button>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            Cliente: {record.client_name}
          </div>
        </div>
      )
    },
    {
      title: 'Hito Cumplido',
      dataIndex: 'milestone_name',
      key: 'milestone_name',
      render: (name: string, record: any) => (
        <div>
          <Text strong>{name}</Text>
          {record.source_milestone_name && (
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
              Entregable PMO: {record.source_milestone_name}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Monto a Facturar',
      key: 'amount',
      render: (_: unknown, record: any) => (
        <div>
          <div style={{ fontWeight: 700, color: token.colorSuccess }}>
            {formatCLP(record.amount_clp)}
          </div>
          {record.currency !== 'CLP' && (
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>
              {record.amount} {record.currency}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Antigüedad Cumplimiento',
      dataIndex: 'days_since_completed',
      key: 'days_since_completed',
      render: (days: number) => {
        if (days > 14) {
          return <Tag color="error">Hace {days} días (URGENTE)</Tag>;
        }
        if (days > 7) {
          return <Tag color="warning">Hace {days} días</Tag>;
        }
        return <Tag color="processing">Hace {days} días</Tag>;
      }
    },
    {
      title: 'Acción',
      key: 'actions',
      render: (_: unknown, record: any) => (
        <Button
          type="primary"
          size="small"
          icon={<DollarOutlined />}
          onClick={() => navigate(`/billing?project_id=${record.project_id}&status=billable`)}
        >
          Facturar
        </Button>
      )
    }
  ];

  const marginColumns = [
    {
      title: 'Proyecto',
      dataIndex: 'project_name',
      key: 'project_name',
      render: (name: string, record: any) => (
        <div>
          <Button
            type="link"
            style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }}
            onClick={() => navigate(`/projects/${record.project_id}`)}
          >
            {name}
          </Button>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            Cliente: {record.client_name}
          </div>
        </div>
      )
    },
    {
      title: 'Margen Cotizado',
      dataIndex: 'quoted_margin_pct',
      key: 'quoted_margin_pct',
      render: (pct: number) => <Tag color="blue">{formatPercent(pct, 0)} cotizado</Tag>
    },
    {
      title: 'Margen Real (HH)',
      dataIndex: 'real_margin_pct',
      key: 'real_margin_pct',
      render: (pct: number) => (
        <Tag color={pct >= 30 ? 'success' : pct > 0 ? 'warning' : 'error'}>
          {formatPercent(pct, 0)} real
        </Tag>
      )
    },
    {
      title: 'Fuga de Margen',
      key: 'leakage',
      render: (_: unknown, record: any) => {
        const leakage = record.margin_leakage_pct;
        if (leakage > 10) {
          return (
            <span style={{ color: token.colorError, fontWeight: 700 }}>
              -{leakage}% (Pérdida de margen)
            </span>
          );
        }
        if (leakage > 0) {
          return (
            <span style={{ color: token.colorWarning, fontWeight: 600 }}>
              -{leakage}%
            </span>
          );
        }
        return (
          <span style={{ color: token.colorSuccess, fontWeight: 600 }}>
            +{Math.abs(leakage)}% (Mayor margen)
          </span>
        );
      }
    },
    {
      title: 'Horas Cotizadas vs Reales',
      key: 'hours',
      render: (_: unknown, record: any) => (
        <div>
          <div>
            <Text strong>{record.real_hours} hrs</Text> de {record.quoted_hours} cotizadas
          </div>
          {record.hours_exceeded > 0 && (
            <div style={{ fontSize: 12, color: token.colorError }}>
              +{record.hours_exceeded} hrs excedidas
            </div>
          )}
        </div>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. KPIs Comerciales */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Revenue Desbloqueado Listo para Facturar"
              value={total_unlocked_revenue_clp}
              formatter={(val) => formatCLP(Number(val))}
              prefix={<DollarOutlined style={{ color: token.colorSuccess }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700, color: token.colorSuccess }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              {ready_to_invoice.length} hitos completados técnicamente sin factura emitida
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Desviaciones de Alcance (Scope Creep)"
              value={scope_creep_alerts.length}
              suffix="proyectos"
              prefix={<ExclamationCircleOutlined style={{ color: scope_creep_alerts.length > 0 ? token.colorError : token.colorSuccess }} />}
              valueStyle={{
                fontSize: 24,
                fontWeight: 700,
                color: scope_creep_alerts.length > 0 ? token.colorError : token.colorSuccess
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              Horas reales superan presupuesto comercial cotizado
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={8}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Cuentas Clave Monitoreadas"
              value={client_scorecards.length}
              suffix="clientes activos"
              prefix={<SmileOutlined style={{ color: token.colorPrimary }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              Portafolio comercial con satisfacción y volumen de venta
            </div>
          </Card>
        </Col>
      </Row>

      {/* 2. Hitos Técnicos Listos para Facturar (Revenue Unlocked) */}
      <Card
        title={
          <Space>
            <DollarOutlined style={{ color: token.colorSuccess }} />
            <span>Hitos Cumplidos en PMO Pendientes de Facturación (Revenue Unlocked)</span>
          </Space>
        }
        extra={
          <Button
            type="primary"
            ghost
            onClick={() => navigate('/billing?status=billable')}
          >
            Ir a Cobranza y Facturación
          </Button>
        }
        styles={{ body: { padding: 16 } }}
        style={{ borderColor: token.colorBorderSecondary }}
      >
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          El equipo de desarrollo ha finalizado estos entregables técnicos. Están listos para emitir la factura respectiva de inmediato.
        </Text>
        {ready_to_invoice.length > 0 ? (
          <Table
            dataSource={ready_to_invoice}
            columns={billableColumns}
            rowKey="milestone_id"
            pagination={{ pageSize: 5 }}
            size="middle"
            scroll={{ x: 750 }}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="No hay hitos pendientes de facturación inmediata"
            description="Todos los hitos entregados ya cuentan con factura emitida."
          />
        )}
      </Card>

      {/* 3. Detección de Scope Creep (Alertas de Addendum) */}
      {scope_creep_alerts.length > 0 && (
        <Card
          title={
            <Space>
              <WarningOutlined style={{ color: token.colorError }} />
              <span>Detección de Scope Creep: Oportunidades de Orden de Cambio (CR)</span>
            </Space>
          }
          styles={{ body: { padding: 16 } }}
          style={{ borderColor: token.colorErrorBorder }}
        >
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            Estos proyectos han consumido más horas de las presupuestadas en la cotización comercial. Requiere evaluar Addendum con el cliente para cobrar adicionales.
          </Text>
          <Row gutter={[12, 12]}>
            {scope_creep_alerts.map((alert) => (
              <Col xs={24} md={12} key={alert.project_id}>
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: token.borderRadius,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorFillAlter,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ fontSize: 15 }}>{alert.project_name}</Text>
                    <Tag color="error">+{alert.overrun_hours} hrs extra</Tag>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Cliente: {alert.client_name} · Cotizadas: {alert.quoted_hours} hrs · Reales: {alert.real_hours} hrs
                  </Text>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    {typeof alert.overrun_cost_clp === 'number' && (
                      <Text style={{ fontSize: 13, color: token.colorError }}>
                        Costo HH adicional estimado: <Text strong>{formatCLP(alert.overrun_cost_clp)}</Text>
                      </Text>
                    )}
                    <Button
                      size="small"
                      style={{ marginInlineStart: 'auto' }}
                      onClick={() => navigate(`/projects/${alert.project_id}?tab=commercial`)}
                    >
                      Ver Cotización / CR
                    </Button>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      {/* 4. Comparativa de Margen (Vendido vs Real): solo llega para team_lead */}
      {margin_variance && (
        <Card
          title={
            <Space>
              <RiseOutlined style={{ color: token.colorPrimary }} />
              <span>Control de Margen Comercial: Cotización Inicial vs Ejecución Real</span>
            </Space>
          }
          styles={{ body: { padding: 16 } }}
          style={{ borderColor: token.colorBorderSecondary }}
        >
          <Table
            dataSource={margin_variance}
            columns={marginColumns}
            rowKey="project_id"
            pagination={{ pageSize: 6 }}
            size="middle"
            scroll={{ x: 750 }}
          />
        </Card>
      )}
    </div>
  );
};
