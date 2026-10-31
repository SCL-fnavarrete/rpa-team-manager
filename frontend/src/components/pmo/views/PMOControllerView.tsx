import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Typography, Progress, Button, Space, Alert, Modal, theme } from 'antd';
import {
  AuditOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BankOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PMOControllerData } from '@/types/pmo';
import { LoadingState, EmptyState } from '@/components/common/FeedbackStates';
import { formatCLP, formatSpanishNumber, formatPercent } from '@/utils';

const { Text } = Typography;

interface PMOControllerViewProps {
  data: PMOControllerData | null;
  loading?: boolean;
}

export const PMOControllerView: React.FC<PMOControllerViewProps> = ({
  data,
  loading = false
}) => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [selectedUserForMissingDays, setSelectedUserForMissingDays] = useState<any>(null);

  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  if (loading) {
    return <LoadingState tip="Cargando perspectiva de Control de Gestión..." minHeight={320} />;
  }

  if (!data) {
    return (
      <EmptyState
        description="No hay información ejecutiva disponible para Control de Gestión."
      />
    );
  }

  const {
    triple_conciliation,
    imputations_audit,
    cost_centers_summary,
    aging_portfolio
  } = data;

  // El costo, el avance de costo y el CPI solo llegan para team_lead: sin ellos la matriz concilia avance físico y facturación
  const hasCostData = triple_conciliation.some((row) => typeof row.cost_consumed_pct === 'number');

  const conciliationColumns = [
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
      title: hasCostData ? 'Triple Avance (% Físico vs Costo vs Factura)' : 'Avance (% Físico vs Factura)',
      key: 'advances',
      width: 280,
      render: (_: unknown, record: any) => (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span>Físico: <b>{record.physical_progress_pct}%</b></span>
            {typeof record.cost_consumed_pct === 'number' && <span>Costo: <b>{record.cost_consumed_pct}%</b></span>}
            <span>Facturado: <b>{record.billed_pct}%</b></span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <Progress percent={record.physical_progress_pct} size="small" showInfo={false} strokeColor={token.colorPrimary} />
            {typeof record.cost_consumed_pct === 'number' && (
              <Progress percent={record.cost_consumed_pct} size="small" showInfo={false} strokeColor={record.cost_consumed_pct > record.physical_progress_pct + 15 ? token.colorError : token.colorWarning} />
            )}
            <Progress percent={record.billed_pct} size="small" showInfo={false} strokeColor={token.colorSuccess} />
          </div>
        </Space>
      )
    },
    {
      title: 'CPI (Cost Efficiency)',
      dataIndex: 'cpi',
      key: 'cpi',
      render: (cpi: number) => {
        const isGood = cpi >= 1.0;
        return (
          <Tag color={isGood ? 'success' : cpi >= 0.8 ? 'warning' : 'error'}>
            CPI {cpi}
          </Tag>
        );
      }
    },
    {
      title: 'Diagnóstico de Conciliación',
      dataIndex: 'deviation_flag',
      key: 'deviation_flag',
      render: (flag: string) => {
        if (flag === 'critical_desynchronization') {
          return (
            <Tag color="error">
              Descalce Crítico (Sobrecosto + No Facturado)
            </Tag>
          );
        }
        if (flag === 'cost_overrun') {
          return <Tag color="error">Sobrecosto (Costo &gt; Físico)</Tag>;
        }
        if (flag === 'unbilled_work') {
          return <Tag color="warning">Riesgo Cobro (Físico &gt; Facturado)</Tag>;
        }
        return <Tag color="success">Equilibrado</Tag>;
      }
    },
    {
      title: hasCostData ? 'Montos Clave (Venta / Costo / Facturado)' : 'Montos Clave (Venta / Facturado)',
      key: 'amounts',
      render: (_: unknown, record: any) => (
        <div style={{ fontSize: 12 }}>
          <div>Venta: {formatCLP(record.sale_price_clp)}</div>
          {typeof record.real_cost_clp === 'number' && (
            <div style={{ color: record.cost_consumed_pct > 100 ? token.colorError : token.colorTextSecondary }}>
              Costo: {formatCLP(record.real_cost_clp)}
            </div>
          )}
          <div style={{ color: token.colorSuccess }}>
            Facturado: {formatCLP(record.invoiced_clp)}
          </div>
        </div>
      )
    }
  ].filter((column) => hasCostData || column.key !== 'cpi');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. KPIs del Controller */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Personas con Días sin Imputar"
              value={imputations_audit.users_with_missing_days.length}
              suffix="desarrolladores"
              prefix={<ClockCircleOutlined style={{ color: imputations_audit.users_with_missing_days.length > 0 ? token.colorWarning : token.colorSuccess }} />}
              valueStyle={{
                fontSize: 24,
                fontWeight: 700,
                color: imputations_audit.users_with_missing_days.length > 0 ? token.colorWarning : token.colorSuccess
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              Auditoría de las últimas 2 semanas laborales
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Timesheets Pendientes de Aprobación"
              value={imputations_audit.pending_approval_periods.length}
              suffix="semanas"
              prefix={<AuditOutlined style={{ color: token.colorInfo }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              Costos reales no congelados hasta aprobación
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Ratio de Horas Facturables (30d)"
              value={imputations_audit.billable_breakdown.billable_pct}
              suffix="%"
              formatter={(val) => formatPercent(Number(val))}
              prefix={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
              valueStyle={{ fontSize: 24, fontWeight: 700 }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              {formatSpanishNumber(imputations_audit.billable_breakdown.total_billable_hours)} hrs facturables de {formatSpanishNumber(imputations_audit.billable_breakdown.total_real_hours)} hrs
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            styles={{ body: { padding: 18 } }}
            style={{
              borderColor: token.colorBorderSecondary,
              background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer
            }}
          >
            <Statistic
              title="Cartera Total Vencida"
              value={aging_portfolio.total_overdue_clp}
              formatter={(val) => formatCLP(Number(val))}
              prefix={<ExclamationCircleOutlined style={{ color: aging_portfolio.total_overdue_clp > 0 ? token.colorError : token.colorSuccess }} />}
              valueStyle={{
                fontSize: 24,
                fontWeight: 700,
                color: aging_portfolio.total_overdue_clp > 0 ? token.colorError : token.colorSuccess
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
              {aging_portfolio.overdue_invoices.length} facturas vencidas impagas
            </div>
          </Card>
        </Col>
      </Row>

      {/* 2. Matriz de Triple Conciliación (Físico vs Costo vs Factura) */}
      <Card
        title={
          <Space>
            <AuditOutlined style={{ color: token.colorPrimary }} />
            <span>
              {hasCostData
                ? 'Matriz de Triple Conciliación de Proyectos (EVM / Físico vs Costo vs Facturación)'
                : 'Conciliación de Avance Físico vs Facturación'}
            </span>
          </Space>
        }
        styles={{ body: { padding: 16 } }}
        style={{ borderColor: token.colorBorderSecondary }}
      >
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
          {hasCostData
            ? 'Control preventivo de descalces: detecta a tiempo proyectos con consumo de costo acelerado sin respaldo de avance físico, o proyectos entregados sin emitir facturas.'
            : 'Control preventivo de descalces: detecta a tiempo proyectos entregados sin emitir facturas.'}
        </Text>
        <Table
          dataSource={triple_conciliation}
          columns={conciliationColumns}
          rowKey="project_id"
          pagination={{ pageSize: 6 }}
          size="middle"
          scroll={{ x: 800 }}
        />
      </Card>

      {/* 3. Auditoría de Imputaciones & Aging de Cartera */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined style={{ color: token.colorWarning }} />
                <span>Auditoría de Imputaciones (Higiene de Timesheet)</span>
              </Space>
            }
            extra={
              <Button size="small" onClick={() => navigate('/time?tab=approvals')}>
                Aprobar Semanas
              </Button>
            }
            styles={{ body: { padding: 16 } }}
            style={{ borderColor: token.colorBorderSecondary }}
          >
            {imputations_audit.users_with_missing_days.length > 0 ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Usuarios con días hábiles sin registro de horas en las últimas 2 semanas:
                </Text>
                {imputations_audit.users_with_missing_days.map((u) => (
                  <div
                    key={u.user_id}
                    style={{
                      padding: '10px 14px',
                      borderRadius: token.borderRadius,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorFillAlter,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <Text strong>{u.user_name}</Text>
                      <Tag style={{ marginInlineStart: 8 }}>{u.user_role}</Tag>
                      <div style={{ fontSize: 12, color: token.colorError, marginTop: 2 }}>
                        {u.missing_days_count} día(s) sin imputar
                      </div>
                    </div>
                    <Button
                      size="small"
                      onClick={() => setSelectedUserForMissingDays(u)}
                    >
                      Ver Fechas
                    </Button>
                  </div>
                ))}
              </Space>
            ) : (
              <Alert
                type="success"
                showIcon
                message="Imputaciones al día"
                description="Todos los colaboradores tienen sus horas registradas para los días hábiles recientes."
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <BankOutlined style={{ color: token.colorInfo }} />
                <span>Aging de Cobranza & Centros de Costos</span>
              </Space>
            }
            extra={
              <Button size="small" onClick={() => navigate('/billing')}>
                Ir a Facturación
              </Button>
            }
            styles={{ body: { padding: 16 } }}
            style={{ borderColor: token.colorBorderSecondary }}
          >
            <div style={{ marginBottom: 14 }}>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Antigüedad de Deuda por Cobrar:
              </Text>
              <Row gutter={[8, 8]}>
                <Col span={8}>
                  <div style={{ padding: '8px 10px', borderRadius: token.borderRadius, background: isDark ? 'rgba(255,255,255,0.03)' : token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <div style={{ fontSize: 11, color: token.colorTextSecondary }}>Vigente (0-30d)</div>
                    <div style={{ fontWeight: 600, color: token.colorSuccess, fontSize: 13 }}>{formatCLP(aging_portfolio.current_clp)}</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ padding: '8px 10px', borderRadius: token.borderRadius, background: isDark ? 'rgba(255,255,255,0.03)' : token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <div style={{ fontSize: 11, color: token.colorTextSecondary }}>Atraso 1-30d</div>
                    <div style={{ fontWeight: 600, color: token.colorWarning, fontSize: 13 }}>{formatCLP(aging_portfolio.overdue_30_clp)}</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ padding: '8px 10px', borderRadius: token.borderRadius, background: isDark ? 'rgba(255,255,255,0.03)' : token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <div style={{ fontSize: 11, color: token.colorTextSecondary }}>Atraso &gt;30d</div>
                    <div style={{ fontWeight: 600, color: token.colorError, fontSize: 13 }}>{formatCLP(aging_portfolio.overdue_60_clp)}</div>
                  </div>
                </Col>
              </Row>
            </div>

            <div>
              <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Asignación por Centros de Costo:
              </Text>
              <Space wrap size={[6, 6]}>
                {cost_centers_summary.map((cc) => (
                  <Tag key={cc.cost_center_id} color={cc.is_rpa ? 'blue' : 'default'} style={{ padding: '4px 8px' }}>
                    {cc.code} ({cc.country}): {cc.allocated_projects_count} proy. · {formatCLP(cc.total_budget_clp)}
                  </Tag>
                ))}
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Modal para ver fechas de días faltantes */}
      <Modal
        title={`Días sin imputar - ${selectedUserForMissingDays?.user_name}`}
        open={Boolean(selectedUserForMissingDays)}
        onCancel={() => setSelectedUserForMissingDays(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setSelectedUserForMissingDays(null)}>
            Cerrar
          </Button>
        ]}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Días hábiles en las últimas 2 semanas sin ninguna entrada de tiempo registrada:
        </Text>
        <Space wrap size={[8, 8]}>
          {selectedUserForMissingDays?.missing_dates.map((dateStr: string) => (
            <Tag key={dateStr} color="error" style={{ fontSize: 13, padding: '4px 10px' }}>
              <CalendarOutlined style={{ marginInlineEnd: 6 }} />
              {dateStr}
            </Tag>
          ))}
        </Space>
      </Modal>
    </div>
  );
};
