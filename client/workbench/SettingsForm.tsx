import { WorkbenchDialog as Modal } from "./WorkbenchDialog";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View, type TextStyle, type ViewStyle } from "react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { checkRpc, tapdSettings, tapdBaseUrlSchema } from "../../shared/contracts";
import { PLUGIN_VERSION } from "../../shared/version";
import type { WorkbenchTheme } from "./bits";
import { ViewsSection, type ReadySettings } from "./ViewsSection";

export function TapdSettingsScreen({ theme }: PluginSurfaceProps) {
  return <SettingsBody theme={theme} />;
}

export function SettingsModal({ open, onClose, theme }: {
  open: boolean;
  onClose: () => void;
  theme: WorkbenchTheme;
}) {
  return <Modal theme={theme} title="TAPD 工作台设置" size="settings" open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <Modal.Content><SettingsBody theme={theme} /></Modal.Content>
  </Modal>;
}

function SettingsBody({ theme }: { theme: WorkbenchTheme }) {
  const settings = useSettings(tapdSettings);
  const styles = useMemo<{ center: ViewStyle; error: TextStyle }>(() => ({
    center: { paddingVertical: 24, alignItems: "center" },
    error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
  }), [theme]);

  if (settings.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foreground} />
      </View>
    );
  }
  if (settings.status === "error") {
    return <Text style={styles.error}>配置读取失败：{settings.error}</Text>;
  }
  if (settings.status === "invalid") {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.error}>配置数据无效：{settings.error}</Text>
        <SettingsAction label="重置配置" actionLabel="重置" onPress={() => void settings.reset()} />
      </View>
    );
  }
  return <SettingsEditor settings={settings} theme={theme} />;
}

function SettingsEditor({ settings, theme }: { settings: ReadySettings; theme: WorkbenchTheme }) {
  const [token, setToken] = useState(settings.values.token);
  const [apiEndpoint, setApiEndpoint] = useState(settings.values.apiEndpoint);
  const [siteUrl, setSiteUrl] = useState(settings.values.siteUrl);
  const [workspaceIds, setWorkspaceIds] = useState(settings.values.workspaceIds);
  const [autoRefresh, setAutoRefresh] = useState(String(settings.values.autoRefreshSeconds || ""));
  const [checkState, setCheckState] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const toast = useToast();
  const check = useRpc(checkRpc);

  function parseAutoRefresh(): number {
    const parsed = Number.parseInt(autoRefresh.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.max(30, Math.min(3600, parsed));
  }

  function validAddresses(): boolean {
    if (tapdBaseUrlSchema.safeParse(apiEndpoint.trim()).success && tapdBaseUrlSchema.safeParse(siteUrl.trim()).success) return true;
    toast.error("地址需为完整 HTTP(S) URL，不能包含账号、密码、查询参数或片段");
    return false;
  }

  async function save() {
    if (!validAddresses()) return;
    const ok = await settings.save(
      {
        ...settings.values,
        apiEndpoint: apiEndpoint.trim(),
        siteUrl: siteUrl.trim(),
        token: token.trim(),
        workspaceIds: workspaceIds.trim(),
        autoRefreshSeconds: parseAutoRefresh(),
      },
      settings.revision,
    );
    if (ok) toast.show("设置已保存", { variant: "success" });
    else toast.error(settings.saveError ?? "保存失败，请重试");
  }

  async function testConnection() {
    if (!validAddresses()) return;
    setTesting(true);
    setCheckState(null);
    try {
      const result = await check({
        apiEndpoint: apiEndpoint.trim(),
        siteUrl: siteUrl.trim(),
        token: token.trim(),
        workspaceIds: workspaceIds.trim(),
      });
      setCheckState({ ok: result.ok, message: result.message });
    } catch (error) {
      setCheckState({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  }

  const resultStyle = useMemo<TextStyle>(() => ({
    color: checkState?.ok ? theme.colors.statusSuccess : theme.colors.statusDanger,
    fontSize: 12,
  }), [theme, checkState?.ok]);

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="连接">
        <SettingsCard>
          <SettingsInput
            label="API 地址"
            hint="凭证会发送到此地址。留空使用 TAPD_API_ENDPOINT，默认 https://api.tapd.cn"
            placeholder="https://api.tapd.cn"
            initialValue={settings.values.apiEndpoint}
            onChangeText={setApiEndpoint}
          />
          <SettingsInput
            label="网页域名"
            hint="用于单据链接。留空使用 TAPD_SITE_URL，默认 https://www.tapd.cn；请包含 https://"
            placeholder="https://www.tapd.cn"
            initialValue={settings.values.siteUrl}
            onChangeText={setSiteUrl}
          />
          <SettingsInput
            label="API Token"
            hint="留空则使用 daemon 环境变量 TAPD_TOKEN；填写后以明文 JSON 保存在 daemon，可被本机设置页读取"
            placeholder="TAPD OpenAPI Token"
            secureTextEntry
            initialValue={settings.values.token}
            onChangeText={setToken}
          />
          <SettingsInput
            label="项目 ID"
            hint="多个项目用英文逗号分隔；留空则使用环境变量 TAPD_WORKSPACE_IDS"
            placeholder="例如 12345678"
            initialValue={settings.values.workspaceIds}
            onChangeText={setWorkspaceIds}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="看板">
        <SettingsCard>
          <SettingsInput
            label="自动刷新间隔（秒）"
            hint="0 或留空=关闭；填写 ≥30 按该秒数定时自动强制刷新看板数据，上限 3600"
            placeholder="0"
            initialValue={String(settings.values.autoRefreshSeconds || "")}
            onChangeText={setAutoRefresh}
          />
        </SettingsCard>
      </SettingsSection>
      <ViewsSection theme={theme} settings={settings} />
      <SettingsSection title="操作">
        <SettingsCard>
          <SettingsAction
            label="保存设置"
            actionLabel={settings.saving ? "保存中…" : "保存"}
            disabled={settings.saving}
            onPress={() => void save()}
          />
          <SettingsAction
            label="测试连接"
            actionLabel={testing ? "测试中…" : "测试"}
            disabled={testing}
            onPress={() => void testConnection()}
          />
          {checkState ? (
            <SettingsRow label="测试结果">
              <Text style={resultStyle}>{checkState.message}</Text>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        插件在 daemon 侧调用 TAPD OpenAPI，凭证仅保存在本机。当前版本 v{PLUGIN_VERSION}。
      </Text>
    </View>
  );
}
