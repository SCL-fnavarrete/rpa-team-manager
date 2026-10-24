import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Progress, Space, Button, Alert, theme } from 'antd';
import {
  DollarOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PMOGeneralManagerData } from '@/types/pmo';
import { LoadingState, EmptyState } from '@/components/common/FeedbackStates';
import { formatCLP, formatPercent } from '@/utils';

const { Text } = Typography;

interface PMOGeneralManagerViewProps {
  data: PMOGeneralManagerData | null;
  loading?: boolean;
  onGoToGantt?: (projectId: number) => void;
}

export const PMOGeneralManagerView: React.FC<PMOGeneralManagerViewProps> = ({
  data,
  loading = false,
  onGoToGantt
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
    return <LoadingState tip="Cargando perspectiva de Gerencia General..." minHeight={320} />;
  }

  if (!data) {
    return (
      <EmptyState
        description="No hay información ejecutiva disponible para Gerencia General."
      />
    );
  }

  const {
    consolidated_pnl,
    cashflow_forecast,
    portfolio_health_summary,
    top_risk_projects,
    team_utilization_summary
  } = data;

  // Costos, utilidad y margen solo llegan para team_lead: sin ellos se omiten esas tarjetas y columnas
  const { avg_margin_pct: avgMarginPct, total_gross_profit_clp: grossProfitClp } = consolidated_pnl;
  const showCostColumn = top_risk_projects.some((project) => typeof project.real_cost_clp === 'number');
  const kpiColumnSpan = typeof avgMarginPct === 'number' ? 6 : 8;

  const riskTableColumns = [
    {
      title: 'Proyecto',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <div>
          <Button
            type="link"
            style={{ padding: 0, fontWeight: 600, height: 'auto', textAlign: 'left' }}
            onClick={() => navigate(`/projects/${record.id}`)}
          >
            {name}
          </Button>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            Cliente: {record.client_name} · Resp: {record.assigned_to_name}
          </div>
        </div>
      )
    },
    {
      title: 'Condición & Diagnóstico',
      key: 'health',
      render: (_: unknown, record: any) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.project_health_status === 'critical' ? 'error' : 'warning'}>
            {record.project_health_status === 'critical' ? 'Riesgo Crítico' : 'En Alerta'}
          </Tag>
          <Text style={{ fontSize: 12, color: record.project_health_status === 'critical' ? token.colorError : token.colorWarning }}>
            {record.critical_reason}
          </Text>
        </Space>
      )
    },
    {
      title: 'Avance Físico',
      dataIndex: 'progress_pct',
      key: 'progress_pct',
      width: 140,
      render: (pct: number) => (
        <div style={{ width: 120 }}>
          <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />
        </div>
      )
    },
    {
      title: 'Desvío Plazo',
      key: 'schedule',
      render: (_: unknown, record: any) => {
        const days = record.schedule_variance_days;
        if (days > 0) {
          return <Tag color="error">+{days} días atraso</Tag>;
        }
        if (record.days_to_deadline !== null && record.days_to_deadline < 0) {
          return <Tag color="error">Vencido hace {Math.abs(record.days_to_deadline)}d</Tag>;
        }
        return <Tag color="success">Al día</Tag>;
      }
    },
    {
      title: 'Impacto Costo Real',
      key: 'cost',
      render: (_: unknown, record: any) => (
        <div>
          <div style={{ fontWeight: 600, color: record.cost_variance_clp > 0 ? token.colorError : token.colorText }}>
            {formatCLP(record.real_cost_clp)}
          </div>
          {record.cost_variance_clp > 0 && (
            <div style={{ fontSize: 11, color: token.colorError }}>
              Sobrecosto: +{formatCLP(record.cost_variance_clp)}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 130,
      render: (_: unknown, record: any) => (
        <Space size="small">
          <Button size="small" onClick={() => navigate(`/projects/${record.id}`)}>
            Ficha
          </Button>
          {onGoToGantt && (
            <Button size="small" type="primary" ghost onClick={() => onGoToGantt(record.id)}>
              Cronograma
            </Button>
          )}
        </Space>
      )
    }
  ].filter((column) => showCostColumn || column.key !== 'cost');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. KPIs Directivos de Alto Nivel */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={kpiColumnSpan}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Venta Total Portafolio"
              value={consolidated_pnl.total_sold_clp}
              formatter={(val) => formatCLP(Number(val))}
              prefix={<DollarOutlined style={{ color: token.colorPrimary }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              {consolidated_pnl.active_projects_count} activos de {consolidated_pnl.total_projects_count} totales
            </div>
          </Card>
        </Col>

        {typeof avgMarginPct === 'number' && (
          <Col xs={24} sm={12} lg={kpiColumnSpan}>
            <Card
              styles={{ body: { padding: 18 } }}
              style={{
                borderColor: token.colorBorderSecondary,
                background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
              }}
            >
              <Statistic
                title="Margen Operacional Consolidado"
                value={avgMarginPct}
                suffix="%"
                formatter={(val) => formatPercent(Number(val))}
                prefix={avgMarginPct >= 25 ? <ArrowUpOutlined style={{ color: token.colorSuccess }} /> : <ArrowDownOutlined style={{ color: token.colorWarning }} />}
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: avgMarginPct >= 25 ? token.colorSuccess : token.colorWarning
                }}
              />
              {typeof grossProfitClp === 'number' && (
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
                  Utilidad bruta: <Text strong>{formatCLP(grossProfitClp)}</Text>
                </div>
              )}
            </Card>
          </Col>
        )}

        <Col xs={24} sm={12} lg={kpiColumnSpan}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Salud de Proyectos"
              value={portfolio_health_summary.critical}
              suffix={
                <span style={{ fontSize: 13, color: token.colorTextSecondary, fontWeight: 'normal' }}>
                  / {consolidated_pnl.total_projects_count} en riesgo
                </span>
              }
              prefix={<WarningOutlined style={{ color: portfolio_health_summary.critical > 0 ? token.colorError : token.colorSuccess }} />}
              valueStyle={{
                fontSize: 24,
                fontWeight: 700,
                color: portfolio_health_summary.critical > 0 ? token.colorError : token.colorSuccess
              }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Tag color="success">{portfolio_health_summary.healthy} Saludables</Tag>
              <Tag color="warning">{portfolio_health_summary.warning} Alerta</Tag>
              <Tag color="error">{portfolio_health_summary.critical} Críticos</Tag>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={kpiColumnSpan}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Eficiencia de Equipo RPA"
              value={consolidated_pnl.billable_hours_ratio}
              suffix="% facturable"
              formatter={(val) => formatPercent(Number(val))}
              prefix={<ThunderboltOutlined style={{ color: token.colorInfo }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              Capacidad: {team_utilization_summary.total_planned_fte} FTEs comprometidos
            </div>
          </Card>
        </Col>
      </Row>

      {/* 2. Top Proyectos Críticos en Riesgo (Radar del CEO) */}
      <Card
        title={
          <Space>
            <WarningOutlined style={{ color: token.colorError }} />
            <span>Radar de Dirección: Proyectos con Riesgo de Margen o Plazo</span>
          </Space>
        }
        extra={
          <Tag color={top_risk_projects.length > 0 ? 'error' : 'success'}>
            {top_risk_projects.length} proyectos requieren atención ejecutiva
          </Tag>
        }
        styles={{ body: { padding: 16 } }}
        style={{ borderColor: token.colorBorderSecondary }}
      >
        {top_risk_projects.length > 0 ? (
          <Table
            dataSource={top_risk_projects}
            columns={riskTableColumns}
            rowKey="id"
            pagination={false}
            size="middle"
            scroll={{ x: 800 }}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Operación bajo control"
            description="Ningún proyecto supera los umbrales de alerta crítica de costo (+20%) o plazo (+5 días)."
          />
        )}
      </Card>

      {/* 3. Proyección de Flujo de Cobranza vs Capacidad del Equipo */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <CalendarOutlined style={{ color: token.colorPrimary }} />
                <span>Proyección de Flujo de Cobranza (Próximos Meses)</span>
              </Space>
            }
            styles={{ body: { padding: 16 } }}
            style={{ borderColor: token.colorBorderSecondary }}
          >
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
              Entrada estimada de capital por hitos de pago planificados y facturación emitida.
            </Text>
            {cashflow_forecast.length > 0 ? (
              <Row gutter={[12, 12]}>
                {cashflow_forecast.slice(0, 4).map((cf) => (
                  <Col xs={24} sm={12} key={cf.month}>
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: token.borderRadius,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        background: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorFillAlter
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Mes: {cf.month}
                      </Text>
                      <div style={{ fontSize: 18, fontWeight: 700, color: token.colorSuccess, marginTop: 4 }}>
                        {formatCLP(cf.expected_amount_clp)}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            ) : (
              <Alert
                type="info"
                showIcon
                message="Sin proyección de hitos de cobro futuros registrados en el sistema."
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <TeamOutlined style={{ color: token.colorInfo }} />
                <span>Balance Estratégico de Capacidad</span>
              </Space>
            }
            styles={{ body: { padding: 16 } }}
            style={{ borderColor: token.colorBorderSecondary }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text>FTEs Asignados a Proyectos</Text>
                  <Text strong>{team_utilization_summary.total_planned_fte} FTEs</Text>
                </div>
                <Progress
                  percent={Math.min(100, Math.round((team_utilization_summary.total_planned_fte / Math.max(1, team_utilization_summary.total_developers)) * 100))}
                  status="active"
                  strokeColor={team_utilization_summary.total_planned_fte > team_utilization_summary.total_developers ? token.colorError : token.colorPrimary}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <Text type="secondary">Desarrolladores con sobrecarga (&gt;1.0 FTE):</Text>
                <Tag color={team_utilization_summary.overutilized_count > 0 ? 'error' : 'default'}>
                  {team_utilization_summary.overutilized_count} personas
                </Tag>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <Text type="secondary">Desarrolladores con capacidad disponible (&lt;0.8 FTE):</Text>
                <Tag color="processing">{team_utilization_summary.underutilized_count} personas</Tag>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <Text type="secondary">En carga óptima (0.8 - 1.0 FTE):</Text>
                <Tag color="success">{team_utilization_summary.optimal_count} personas</Tag>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
