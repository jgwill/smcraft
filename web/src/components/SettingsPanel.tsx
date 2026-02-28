"use client";

import { useDesignerStore } from "@/store/useDesignerStore";

export default function SettingsPanel() {
  const settings = useDesignerStore((s) => s.definition.settings);
  const context = useDesignerStore((s) => s.definition.settings.context);
  const updateSettings = useDesignerStore((s) => s.updateSettings);

  return (
    <div className="p-3 space-y-3 text-sm">
      <h3 className="text-xs font-semibold text-gray-400">Machine Settings</h3>

      <label className="block">
        <span className="text-xs text-gray-500">Namespace</span>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
          value={settings.namespace}
          onChange={(e) => updateSettings({ namespace: e.target.value })}
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-500">Name</span>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
          value={settings.name ?? ""}
          onChange={(e) => updateSettings({ name: e.target.value || undefined })}
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-500">Description</span>
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 h-12"
          value={settings.description ?? ""}
          onChange={(e) => updateSettings({ description: e.target.value || undefined })}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={settings.asynchronous}
          onChange={(e) => updateSettings({ asynchronous: e.target.checked })}
          className="rounded bg-gray-800 border-gray-600"
        />
        Asynchronous
      </label>

      <hr className="border-gray-800" />

      <h4 className="text-xs font-semibold text-gray-500">Context</h4>
      <label className="block">
        <span className="text-xs text-gray-500">Context Class</span>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          value={context?.className ?? ""}
          placeholder="e.g. MyStateMachineContext"
          onChange={(e) =>
            updateSettings({
              context: { ...context, className: e.target.value || undefined },
            })
          }
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">Base Class</span>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          value={context?.baseClass ?? ""}
          placeholder="e.g. Context"
          onChange={(e) =>
            updateSettings({
              context: { ...context, baseClass: e.target.value || undefined },
            })
          }
        />
      </label>

      <hr className="border-gray-800" />

      <h4 className="text-xs font-semibold text-gray-500">Imports</h4>
      <textarea
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 h-16 font-mono"
        value={(settings.imports ?? []).join("\n")}
        placeholder="One import per line"
        onChange={(e) =>
          updateSettings({
            imports: e.target.value ? e.target.value.split("\n") : [],
          })
        }
      />

      <hr className="border-gray-800" />

      <h4 className="text-xs font-semibold text-gray-500">Object References</h4>
      <textarea
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 h-12 font-mono"
        value={(settings.objects ?? []).map((o) => `${o.name}: ${o.type}`).join("\n")}
        placeholder="name: type (one per line)"
        onChange={(e) => {
          const objects = e.target.value
            .split("\n")
            .filter((l) => l.includes(":"))
            .map((l) => {
              const [name, type] = l.split(":").map((s) => s.trim());
              return { name, type };
            });
          updateSettings({ objects });
        }}
      />

      <hr className="border-gray-800" />

      <h4 className="text-xs font-semibold text-gray-500">Code Generation</h4>
      <label className="block">
        <span className="text-xs text-gray-500">Target Language</span>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          value={settings.targetLanguage ?? "python"}
          onChange={(e) => updateSettings({ targetLanguage: e.target.value })}
        >
          <option value="python">Python</option>
          <option value="typescript">TypeScript</option>
          <option value="csharp">C#</option>
        </select>
      </label>
    </div>
  );
}
