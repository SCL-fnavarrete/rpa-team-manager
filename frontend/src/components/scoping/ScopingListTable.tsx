import React from 'react';
import { 
  Table, 
  Tag, 
  Button, 
  Space, 
  Typography, 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Input, 
  Select, 
  Popconfirm, 
  Tooltip,
  theme 
} from 'antd';
import { 
  SearchOutlined, 
  EyeOutlined, 
  EditOutlined,
  DeleteOutlined, 
  RocketOutlined, 
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  CalculatorOutlined,
  DollarOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { ScopingQuotationRecord, ScopingKpis } from '../../types/scoping';

const { Text } = Typography;

interface ScopingListTableProps {
  items: ScopingQuotationRecord[];
  kpis: ScopingKpis;
  loading: boolean;
  onViewProposal: (item: ScopingQuotationRecord) => void;
  onEdit: (item: ScopingQuotationRecord) => void;
  onDelete: (id: number) => void;
  onConvertToProject: (id: number) => void;
  onSearchChange: (val: string) => void;
  onStatusFilterChange: (val: string | undefined) => void;
  searchValue: string;
  statusFilter?: string;
  onNewScoping: () => void;
}

export const ScopingListTable: React.FC<ScopingListTableProps> = ({
  items,
  kpis,
  loading,
  onViewProposal,
  onEdit,
  onDelete,
  onConvertToProject,
  onSearchChange,
  onStatusFilterChange,
  searchValue,
  statusFilter,
  onNewScoping
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  const viabilityTag = (status: string) => {
    switch (status) {
      case 'viable':
        return <Tag color="success" icon={<CheckCircleOutlined />}>Factible</Tag>;
      case 'digitize_first':
        return <Tag color="warning" icon={<WarningOutlined />}>Digitalizar 1°</Tag>;
      case 'postpone':
        return <Tag color="processing" icon={<ClockCircleOutlined />}>Posponer</Tag>;
      case 'low_viability':
        return <Tag color="volcano" icon={<CloseCircleOutlined />}>Baja Viabilidad</Tag>;
      case 'not_viable':
        return <Tag color="error" icon={<CloseCircleOutlined />}>No Viable</Tag>;
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const effortTag = (effort: string) => {
    switch (effort) {
      case 'low':
        return <Tag color="cyan">Bajo</Tag>;
      case 'medium':
        return <Tag color="orange">Mediano</Tag>;
      case 'high':
        return <Tag color="red">Alto</Tag>;
      default:
        return <Tag>{effort}</Tag>;
    }
  };

  const statusTag = (st: string) => {
    switch (st) {
      case 'draft':
        return <Tag color="default">Borrador</Tag>;
      case 'sent_to_client':
        return <Tag color="blue">Enviada al Cliente</Tag>;
      case 'approved':
        return <Tag color="green">Aprobada</Tag>;
      case 'rejected':
        return <Tag color="magenta">Rechazada</Tag>;
      case 'converted_to_project':
        return <Tag color="purple" icon={<RocketOutlined />}>Convertida a Proyecto</Tag>;
      default:
        return <Tag>{st}</Tag>;
    }
  };

  const columns = [
    {
      title: 'Código',
      dataIndex: 'code',
      key: 'code',
      width: 130,
      render: (code: string, record: ScopingQuotationRecord) => (
        <a onClick={() => onViewProposal(record)}>
          <Text strong style={{ color: token.colorPrimary }}>{code}</Text>
        </a>
      )
    },
    {
      title: 'Cliente / Proceso',
      key: 'client_process',
      render: (_: any, record: ScopingQuotationRecord) => (
        <div>
          <Text strong>{record.client_name}</Text>
          <div style={{ fontSize: 12 }}>
            <Text type="secondary">{record.process_name}</Text>
            {record.business_unit ? ` (${record.business_unit})` : ''}
          </div>
        </div>
      )
    },
    {
      title: 'Viabilidad',
      dataIndex: 'viability_status',
      key: 'viability_status',
      width: 140,
      render: (v: string) => viabilityTag(v)
    },
    {
      title: 'Esfuerzo',
      dataIndex: 'effort_level',
      key: 'effort_level',
      width: 100,
      render: (e: string) => effortTag(e)
    },
    {
      title: 'Horas / Plazo',
      key: 'hours',
      width: 140,
      render: (_: any, record: ScopingQuotationRecord) => (
        <div>
          <Text strong>{record.total_hours} HH</Text>
          <div style={{ fontSize: 12 }}>
            <Text type="secondary">{record.estimated_weeks} semanas</Text>
          </div>
        </div>
      )
    },
    {
      title: 'Precio Venta',
      dataIndex: 'proposed_price',
      key: 'proposed_price',
      width: 140,
      align: 'right' as const,
      render: (price: number, record: ScopingQuotationRecord) => (
        <div>
          <Text strong style={{ color: token.colorSuccess }}>
            {record.currency} {price.toLocaleString('es-CL')}
          </Text>
          <div style={{ fontSize: 11 }}>
            <Text type="secondary">Margen ~{record.projected_margin_pct}%</Text>
          </div>
        </div>
      )
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      width: 160,
      render: (st: string) => statusTag(st)
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 150,
      align: 'right' as const,
      render: (_: any, record: ScopingQuotationRecord) => (
        <Space size={4}>
          <Tooltip title="Ver Propuesta Técnico-Económica">
            <Button 
              size="small" 
              icon={<EyeOutlined />} 
              onClick={() => onViewProposal(record)} 
            />
          </Tooltip>

          {record.status !== 'converted_to_project' && (
            <Tooltip title="Editar Levantamiento">
              <Button 
                size="small" 
                icon={<EditOutlined />} 
                onClick={() => onEdit(record)} 
              />
            </Tooltip>
          )}

          {record.status !== 'converted_to_project' && (
            <Tooltip title="Convertir a Proyecto Formal">
              <Button 
                size="small" 
                type="primary"
                icon={<RocketOutlined />} 
                onClick={() => onConvertToProject(record.id)} 
              />
            </Tooltip>
          )}

          {record.status !== 'converted_to_project' && (
            <Popconfirm
              title="¿Eliminar este levantamiento?"
              description="Esta acción eliminará el registro de cotización."
              onConfirm={() => onDelete(record.id)}
              okText="Eliminar"
              cancelText="Cancelar"
            >
              <Button 
                size="small" 
                danger 
                icon={<DeleteOutlined />} 
              />
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* 1. KPIs Globales */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card 
            styles={{ body: { padding: '14px 18px' } }}
            style={{ 
              border: `1px solid ${token.colorBorderSecondary}`,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
            }}
          >
            <Statistic 
              title={<Text type="secondary" style={{ fontSize: 12 }}>Levantamientos Realizados</Text>}
              value={kpis.total_scopings}
              prefix={<FileTextOutlined style={{ color: token.colorPrimary }} />}
            />
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card 
            styles={{ body: { padding: '14px 18px' } }}
            style={{ 
              border: `1px solid ${token.colorBorderSecondary}`,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
            }}
          >
            <Statistic 
              title={<Text type="secondary" style={{ fontSize: 12 }}>Tasa de Viabilidad RPA</Text>}
              value={kpis.viable_percentage}
              suffix="%"
              prefix={<CheckCircleOutlined style={{ color: token.colorSuccess }} />}
              valueStyle={{ color: token.colorSuccess }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card 
            styles={{ body: { padding: '14px 18px' } }}
            style={{ 
              border: `1px solid ${token.colorBorderSecondary}`,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
            }}
          >
            <Statistic 
              title={<Text type="secondary" style={{ fontSize: 12 }}>Total Horas Cotizadas</Text>}
              value={kpis.total_quoted_hours}
              suffix="HH"
              prefix={<CalculatorOutlined style={{ color: token.colorWarning }} />}
            />
          </Card>
        </Col>

        <Col xs={12} sm={6}>
          <Card 
            styles={{ body: { padding: '14px 18px' } }}
            style={{ 
              border: `1px solid ${token.colorBorderSecondary}`,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
            }}
          >
            <Statistic 
              title={<Text type="secondary" style={{ fontSize: 12 }}>Monto Total Propuesto</Text>}
              value={kpis.total_proposed_amount}
              prefix={<DollarOutlined style={{ color: token.colorPrimary }} />}
              formatter={(val) => `$ ${Number(val).toLocaleString('es-CL')}`}
            />
          </Card>
        </Col>
      </Row>

      {/* 2. Barra de Búsqueda y Filtros */}
      <Card 
        styles={{ body: { padding: 14 } }}
        style={{ 
          marginBottom: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : token.colorBgContainer
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Space wrap size={10}>
            <Input 
              placeholder="Buscar por cliente, proceso o código..."
              prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ width: 280 }}
              allowClear
            />
            <Select 
              placeholder="Filtrar por estado"
              value={statusFilter}
              onChange={onStatusFilterChange}
              allowClear
              style={{ width: 180 }}
              options={[
                { value: 'draft', label: 'Borrador' },
                { value: 'sent_to_client', label: 'Enviada al Cliente' },
                { value: 'approved', label: 'Aprobada' },
                { value: 'rejected', label: 'Rechazada' },
                { value: 'converted_to_project', label: 'Convertida a Proyecto' }
              ]}
            />
          </Space>

          <Button 
            type="primary" 
            icon={<CalculatorOutlined />} 
            onClick={onNewScoping}
          >
            Nuevo Levantamiento (15 min)
          </Button>
        </div>
      </Card>

      {/* 3. Tabla Principal */}
      <Table 
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        locale={{
          emptyText: <Text type="secondary">No se encontraron levantamientos ni cotizaciones.</Text>
        }}
      />
    </div>
  );
};
