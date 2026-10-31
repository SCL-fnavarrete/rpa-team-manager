import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Typography,
  Space,
  message,
  Row,
  Col,
  Alert,
  Divider,
  Tag,
  Modal,
  Spin,
  Select,
  theme
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  SafetyOutlined,
  RobotOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { useLLMConfigStore, LLMProvider, DEFAULT_AVAILABLE_MODELS } from '@/store/llmConfigStore';
import { SkillConfigModal } from '@/components/projects/SkillConfigModal';
import { AIUsagePanel } from '@/components/settings/AIUsagePanel';

const REASONING_LABELS: Record<string, string> = {
  none: 'Sin razonamiento',
  minimal: 'Mínimo',
  low: 'Ligero',
  medium: 'Medio',
  high: 'Alto',
  xhigh: 'Muy alto',
  max: 'Máximo'
};

const { Title, Text, Paragraph } = Typography;

interface ProviderConfig {
  key: LLMProvider;
  name: string;
  icon: string;
  description: string;
  docUrl: string;
  placeholder: string;
  defaultModel: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    icon: '🤖',
    description: 'GPT-6 Luna, GPT-5.4, GPT-5, serie o3 / o4-mini, GPT-4.1 y GPT-4o con nivel de razonamiento configurable',
    docUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    defaultModel: 'gpt-5.4'
  },
  {
    key: 'claude',
    name: 'Anthropic Claude',
    icon: '🧠',
    description: 'Claude 4.6, Claude 4.5, Claude 4 (Opus, Sonnet, Haiku), Claude 3.7 y Claude 3.5 con razonamiento extendido',
    docUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-4-6'
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    icon: '✨',
    description: 'Gemini 3.1 / 3 Preview, Gemini 2.5 (Pro, Flash, Flash-Lite), Gemini 2.0 y Gemma 3',
    docUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...',
    defaultModel: 'gemini-2.5-pro'
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    icon: '🔍',
    description: 'DeepSeek V3.2 Chat, DeepSeek R1 (Reasoner) y DeepSeek Coder',
    docUrl: 'https://platform.deepseek.com/api_keys',
    placeholder: 'sk-...',
    defaultModel: 'deepseek-chat'
  }
];

export const LLMConfigPage: React.FC = () => {
  const { token } = theme.useToken();
  const {
    apiKeys,
    availableModels,
    isLoading,
    error,
    validating,
    fetchApiKeys,
    fetchAvailableModels,
    validateApiKey,
    saveApiKey,
    updateApiKey,
    deleteApiKey,
    clearError
  } = useLLMConfigStore();

  const [editingProvider, setEditingProvider] = useState<LLMProvider | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  const [replaceKey, setReplaceKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [validationResults, setValidationResults] = useState<Record<LLMProvider, boolean | null>>({
    openai: null,
    claude: null,
    gemini: null,
    deepseek: null
  });
  const [skillModalOpen, setSkillModalOpen] = useState(false);

  const modelsCatalog = availableModels || DEFAULT_AVAILABLE_MODELS;

  useEffect(() => {
    fetchApiKeys();
    fetchAvailableModels();
  }, [fetchApiKeys, fetchAvailableModels]);

  useEffect(() => {
    if (error) {
      message.error(error);
      clearError();
    }
  }, [error, clearError]);

  const getProviderKey = (provider: LLMProvider) => {
    return apiKeys.find(k => k.provider === provider);
  };

  const handleValidate = async (provider: LLMProvider) => {
    if (!apiKeyInput.trim()) {
      message.warning('Por favor ingrese una API key');
      return;
    }

    try {
      const result = await validateApiKey(provider, apiKeyInput);

      if (result.is_valid) {
        message.success('API key válida ✓');
        setValidationResults(prev => ({ ...prev, [provider]: true }));
      } else {
        message.error(`API key inválida: ${result.error}`);
        setValidationResults(prev => ({ ...prev, [provider]: false }));
      }
    } catch (error) {
      setValidationResults(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleSave = async (provider: LLMProvider) => {
    const needsKey = !getProviderKey(provider) || replaceKey;
    if (needsKey && !apiKeyInput.trim()) {
      message.warning('Por favor ingrese una API key');
      return;
    }

    if (needsKey && validationResults[provider] !== true) {
      message.warning('Por favor valide la API key antes de guardar');
      return;
    }

    if (!selectedModel) {
      message.warning('Por favor seleccione un modelo');
      return;
    }

    try {
      const existingKey = getProviderKey(provider);

      if (existingKey) {
        await updateApiKey(provider, apiKeyInput.trim(), selectedModel, reasoningEffort);
        message.success('Configuración actualizada exitosamente');
      } else {
        await saveApiKey(provider, apiKeyInput.trim(), selectedModel, reasoningEffort);
        message.success('API key guardada exitosamente');
      }

      setEditingProvider(null);
      setApiKeyInput('');
      setSelectedModel('');
      setValidationResults(prev => ({ ...prev, [provider]: null }));
    } catch (error) {
      // Error already handled by store
    }
  };

  const handleDelete = (provider: LLMProvider) => {
    Modal.confirm({
      title: '¿Eliminar API Key?',
      content: `¿Está seguro que desea eliminar la API key de ${PROVIDERS.find(p => p.key === provider)?.name}?`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          await deleteApiKey(provider);
          message.success('API key eliminada');
        } catch (error) {
          // Error already handled by store
        }
      }
    });
  };

  const handleEdit = (provider: LLMProvider) => {
    setEditingProvider(provider);
    setApiKeyInput('');
    const existingKey = getProviderKey(provider);
    const providerConfig = PROVIDERS.find(p => p.key === provider);
    const providerModels = modelsCatalog[provider] || DEFAULT_AVAILABLE_MODELS[provider] || [];
    const initialModel = existingKey?.selected_model || providerConfig?.defaultModel || providerModels[0]?.value || '';
    setSelectedModel(initialModel);
    const options = providerModels.find(m => m.value === initialModel)?.reasoning_options;
    setReasoningEffort(options ? existingKey?.reasoning_effort || 'low' : null);
    setReplaceKey(false);
    setValidationResults(prev => ({ ...prev, [provider]: null }));
  };

  const handleCancel = () => {
    setEditingProvider(null);
    setApiKeyInput('');
    setSelectedModel('');
    setValidationResults(_prev => ({
      openai: null,
      claude: null,
      gemini: null,
      deepseek: null
    }));
  };

  const renderProviderCard = (providerConfig: ProviderConfig) => {
    const { key, name, icon, description, docUrl, placeholder } = providerConfig;
    const savedKey = getProviderKey(key);
    const isEditing = editingProvider === key;
    const isValidating = validating[key];
    const validationResult = validationResults[key];
    const providerModels = modelsCatalog[key] || DEFAULT_AVAILABLE_MODELS[key] || [];
    const reasoningOptions = providerModels.find(m => m.value === selectedModel)?.reasoning_options;

    return (
      <Col xs={24} lg={12} key={key}>
        <Card
          title={
            <Space>
              <span style={{ fontSize: '24px' }}>{icon}</span>
              <span>{name}</span>
              <Tag>{providerModels.length} modelos</Tag>
              {savedKey && savedKey.is_valid && (
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  Configurado
                </Tag>
              )}
            </Space>
          }
          extra={
            savedKey && !isEditing && (
              <Space>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => handleEdit(key)}
                >
                  Editar
                </Button>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(key)}
                >
                  Eliminar
                </Button>
              </Space>
            )
          }
          styles={{ body: { padding: '20px' } }}
        >
          <Paragraph type="secondary" style={{ marginBottom: '12px' }}>
            {description}
          </Paragraph>

          {!isEditing && (
            <div style={{ marginBottom: '16px' }}>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Modelos disponibles ({providerModels.length}):
              </Text>
              <Space size={[4, 6]} wrap>
                {providerModels.slice(0, 6).map(m => (
                  <Tag
                    key={m.value}
                    color={savedKey?.selected_model === m.value ? 'blue' : undefined}
                    style={{ margin: 0 }}
                  >
                    {m.label}
                  </Tag>
                ))}
                {providerModels.length > 6 && (
                  <Tag style={{ margin: 0 }}>+{providerModels.length - 6} más</Tag>
                )}
              </Space>
            </div>
          )}

          {savedKey && !isEditing ? (
            <div>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>Clave API: </Text>
                  <Text code>{savedKey.api_key_masked}</Text>
                </div>
                {savedKey.selected_model && (
                  <div>
                    <Text strong>Modelo activo: </Text>
                    <Tag color="blue">
                      {providerModels.find(m => m.value === savedKey.selected_model)?.label || savedKey.selected_model}
                    </Tag>
                  </div>
                )}
                <div>
                  <Text strong>Razonamiento: </Text>
                  {REASONING_LABELS[savedKey.reasoning_effort || ''] ||
                    (providerModels.find(m => m.value === savedKey.selected_model)?.reasoning_options
                      ? 'Ligero'
                      : 'No configurable para este modelo')}
                </div>
                {savedKey.last_validated && (
                  <div>
                    <Text type="secondary">
                      Última validación: {new Date(savedKey.last_validated).toLocaleString('es-CL')}
                    </Text>
                  </div>
                )}
                {savedKey.validation_error && (
                  <Alert
                    message="Error de validación"
                    description={savedKey.validation_error}
                    type="error"
                    showIcon
                  />
                )}
              </Space>
            </div>
          ) : isEditing ? (
            <div>
              <Form layout="vertical">
                {savedKey && !replaceKey ? (
                  <Form.Item label="Clave API">
                    <Input value="••••••••••••" disabled />
                    <Text type="secondary">Clave guardada. Se conserva al cambiar el modelo o el razonamiento.</Text>
                    <Button type="link" onClick={() => setReplaceKey(true)}>Reemplazar clave API</Button>
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="Clave API"
                    help={
                      <a href={docUrl} target="_blank" rel="noopener noreferrer">
                        Obtener API key →
                      </a>
                    }
                  >
                    <Input.Password
                      placeholder={placeholder}
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                        setValidationResults(prev => ({ ...prev, [key]: null }));
                      }}
                      prefix={<KeyOutlined />}
                      suffix={
                        validationResult === true ? (
                          <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                        ) : validationResult === false ? (
                          <CloseCircleOutlined style={{ color: token.colorError }} />
                        ) : null
                      }
                    />
                  </Form.Item>
                )}

                <Form.Item
                  label="Modelo"
                  help="Seleccione el modelo que desea utilizar"
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Seleccionar modelo"
                    value={selectedModel || undefined}
                    onChange={(value) => {
                      setSelectedModel(value);
                      setReasoningEffort(providerModels.find(m => m.value === value)?.reasoning_options ? 'low' : null);
                    }}
                    options={providerModels}
                    style={{ width: '100%' }}
                  />
                </Form.Item>

                <Form.Item label="Razonamiento" help="Un nivel mayor puede aumentar el consumo y el tiempo de respuesta.">
                  {reasoningOptions ? (
                    <Select
                      aria-label="Razonamiento"
                      value={reasoningEffort}
                      onChange={setReasoningEffort}
                      options={reasoningOptions.map(value => ({ value, label: REASONING_LABELS[value] || value }))}
                    />
                  ) : (
                    <Text type="secondary">Este modelo no admite un nivel de razonamiento configurable en esta integración.</Text>
                  )}
                </Form.Item>
                <Space>
                  <Button
                    icon={<SafetyOutlined />}
                    onClick={() => handleValidate(key)}
                    loading={isValidating}
                    disabled={!apiKeyInput.trim()}
                  >
                    Validar
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => handleSave(key)}
                    loading={isLoading}
                    disabled={((!savedKey || replaceKey) && validationResult !== true) || !selectedModel}
                  >
                    {savedKey ? 'Actualizar' : 'Guardar'}
                  </Button>
                  <Button onClick={handleCancel}>Cancelar</Button>
                </Space>
              </Form>
            </div>
          ) : null}

          {!savedKey && !isEditing && (
            <Button type="dashed" block onClick={() => handleEdit(key)}>
              Configurar {name}
            </Button>
          )}
        </Card>
      </Col>
    );
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>
          <KeyOutlined style={{ marginRight: '8px' }} />
          Configuración de LLM
        </Title>
        <Paragraph>
          Configure sus API keys para diferentes proveedores de modelos de lenguaje.
          Las API keys se almacenan de forma segura y encriptada.
        </Paragraph>

        <Alert
          message="Información de Seguridad"
          description="Sus API keys son encriptadas antes de almacenarse en la base de datos. Nunca compartiremos sus credenciales con terceros."
          type="info"
          showIcon
          style={{ marginTop: '16px' }}
        />
      </div>

      <AIUsagePanel />

      <Divider />

      <Spin spinning={isLoading && apiKeys.length === 0}>
        <Row gutter={[16, 16]}>
          {PROVIDERS.map(provider => renderProviderCard(provider))}
        </Row>
      </Spin>

      <Divider style={{ margin: '36px 0 24px 0' }} />

      {/* Skills Configuration Section */}
      <div style={{ marginBottom: '24px' }}>
        <Title level={3}>
          <RobotOutlined style={{ marginRight: '8px', color: token.colorPrimary }} />
          Skills de IA del Equipo RPA
        </Title>
        <Paragraph type="secondary">
          Gestiona los agentes y directivas preconfiguradas que se ejecutan automáticamente en los proyectos y módulos del sistema.
        </Paragraph>

        <Card className="ai-skill-config-card">
          <Row justify="space-between" align="middle" gutter={[16, 16]}>
            <Col xs={24} md={18}>
              <Space align="center" size="middle">
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    backgroundColor: token.colorSuccess,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: token.colorTextLightSolid,
                    fontSize: 24
                  }}
                >
                  <RobotOutlined />
                </div>
                <div>
                  <Space align="center">
                    <Title level={4} style={{ margin: 0 }}>
                      Skill: Revisor IA de Proyecto RPA
                    </Title>
                    <Tag color="success">Activa</Tag>
                    <Tag color="blue">v1.1.0</Tag>
                  </Space>
                  <Paragraph type="secondary" style={{ margin: '4px 0 0 0' }}>
                    Auditoría inteligente del estado real de proyectos: diagnóstico de salud, detección de cuellos de botella, plan de acción táctico y redacción de reporte al cliente.
                  </Paragraph>
                </div>
              </Space>
            </Col>

            <Col xs={24} md={6} style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<SettingOutlined />}
                size="large"
                onClick={() => setSkillModalOpen(true)}
              >
                Configurar Skill
              </Button>
            </Col>
          </Row>
        </Card>
      </div>

      <SkillConfigModal
        visible={skillModalOpen}
        onClose={() => setSkillModalOpen(false)}
      />
    </div>
  );
};

export default LLMConfigPage;
