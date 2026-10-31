import React from 'react';
import { Card, Segmented, Space, Typography, Tag, Button, Tooltip, theme } from 'antd';
import {
  CrownOutlined,
  DollarOutlined,
  AuditOutlined,
  ProjectOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { PMORolePerspective, PMOExecutiveSuiteResponse } from '@/types/pmo';

const { Title, Text } = Typography;

interface PMORoleHeaderProps {
  currentPerspective: PMORolePerspective;
  onPerspectiveChange: (perspective: PMORolePerspective) => void;
  executiveData: PMOExecutiveSuiteResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export const PMORoleHeader: React.FC<PMORoleHeaderProps> = ({
  currentPerspective,
  onPerspectiveChange,
  executiveData,
  loading,
  onRefresh
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  const criticalCount = executiveData?.general_manager.portfolio_health_summary.critical || 0;
  const readyToInvoiceCount = executiveData?.commercial.ready_to_invoice.length || 0;
  const missingImputationsCount = executiveData?.controller.imputations_audit.users_with_missing_days.length || 0;

  const perspectiveOptions = [
    {
      value: 'general_manager',
      label: (
        <Space direction="horizontal" size={6} style={{ padding: '4px 6px' }}>
          <CrownOutlined style={{ color: token.colorPrimary }} />
          <span>Dirección General</span>
          {criticalCount > 0 && (
            <Tag color="error" style={{ marginInlineStart: 4, borderRadius: 10, padding: '0 6px', fontSize: 11 }}>
              {criticalCount} en riesgo
            </Tag>
          )}
        </Space>
      )
    },
    {
      value: 'commercial',
      label: (
        <Space direction="horizontal" size={6} style={{ padding: '4px 6px' }}>
          <DollarOutlined style={{ color: token.colorSuccess }} />
          <span>Comercial & Revenue</span>
          {readyToInvoiceCount > 0 && (
            <Tag color="processing" style={{ marginInlineStart: 4, borderRadius: 10, padding: '0 6px', fontSize: 11 }}>
              {readyToInvoiceCount} por facturar
            </Tag>
          )}
        </Space>
      )
    },
    {
      value: 'controller',
      label: (
        <Space direction="horizontal" size={6} style={{ padding: '4px 6px' }}>
          <AuditOutlined style={{ color: token.colorWarning }} />
          <span>Controller & Gestión</span>
          {missingImputationsCount > 0 && (
            <Tag color="warning" style={{ marginInlineStart: 4, borderRadius: 10, padding: '0 6px', fontSize: 11 }}>
              {missingImputationsCount} sin imputar
            </Tag>
          )}
        </Space>
      )
    },
    {
      value: 'operations',
      label: (
        <Space direction="horizontal" size={6} style={{ padding: '4px 6px' }}>
          <ProjectOutlined style={{ color: token.colorInfo }} />
          <span>PMO Operativo</span>
        </Space>
      )
    }
  ];

  return (
    <Card
      styles={{
        body: {
          padding: '16px 20px',
          background: isDark ? 'rgba(255, 255, 255, 0.02)' : token.colorBgContainer,
          borderRadius: token.borderRadiusLG
        }
      }}
      style={{
        marginBottom: 20,
        borderColor: token.colorBorderSecondary
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16
        }}
      >
        <div>
          <Space align="center" size={8}>
            <Title level={4} style={{ margin: 0 }}>
              Centro PMO
            </Title>
            <Tag color="blue" style={{ borderRadius: 4 }}>
              SUITE INTEGRAL
            </Tag>
          </Space>
          <div>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Control ejecutivo, financiero, comercial y operativo adaptado a cada rol de liderazgo.
            </Text>
          </div>
        </div>

        <Space wrap align="center" size={12}>
          <Text strong style={{ fontSize: 13, color: token.colorTextSecondary }}>
            Perspectiva:
          </Text>
          <Segmented
            value={currentPerspective}
            onChange={(val) => onPerspectiveChange(val as PMORolePerspective)}
            options={perspectiveOptions}
            size="large"
            style={{
              background: isDark ? 'rgba(255, 255, 255, 0.05)' : token.colorFillAlter,
              padding: 4
            }}
          />
          <Tooltip title="Actualizar datos ejecutivos">
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={onRefresh}
              loading={loading}
            />
          </Tooltip>
        </Space>
      </div>
    </Card>
  );
};
