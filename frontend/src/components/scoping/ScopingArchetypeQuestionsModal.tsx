import React from 'react';
import { Modal, Typography, List, Tag, Alert, Button, Space, theme } from 'antd';
import { QuestionCircleOutlined, ThunderboltOutlined, DesktopOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { RPAArchetype } from '../../types/scoping';

const { Text, Title } = Typography;

interface ScopingArchetypeQuestionsModalProps {
  visible: boolean;
  onClose: () => void;
  archetype?: RPAArchetype;
}

export const ScopingArchetypeQuestionsModal: React.FC<ScopingArchetypeQuestionsModalProps> = ({
  visible,
  onClose,
  archetype
}) => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  if (!archetype) return null;

  return (
    <Modal
      title={
        <Space align="center">
          <ThunderboltOutlined style={{ color: token.colorPrimary }} />
          <span>Guía de Preguntas Certeras: {archetype.name}</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          Entendido, continuar reunión
        </Button>
      ]}
      width={720}
      styles={{ body: { padding: '16px 24px' } }}
    >
      <div style={{ marginBottom: 14 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {archetype.description}
        </Text>
      </div>

      <div style={{ 
        padding: '10px 14px', 
        borderRadius: 8, 
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DesktopOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 12 }}>Ecosistema y Sistemas Típicos:</Text>
        </div>
        <div style={{ marginTop: 4 }}>
          <Text>{archetype.typical_systems}</Text>
        </div>
      </div>

      <Title level={5} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <QuestionCircleOutlined style={{ color: token.colorWarning }} />
        Preguntas Clave para los 15 minutos:
      </Title>

      <List
        size="small"
        bordered
        dataSource={archetype.recommended_questions}
        renderItem={(q, idx) => (
          <List.Item style={{ padding: '10px 14px' }}>
            <Space align="start">
              <Tag color="blue">{idx + 1}</Tag>
              <Text strong style={{ fontSize: 13 }}>{q}</Text>
            </Space>
          </List.Item>
        )}
      />

      <div style={{ marginTop: 14 }}>
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="Beneficio típico esperado para el cliente"
          description={<Text type="secondary" style={{ fontSize: 12 }}>{archetype.typical_benefits}</Text>}
        />
      </div>
    </Modal>
  );
};
