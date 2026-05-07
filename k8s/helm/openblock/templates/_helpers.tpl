{{/*
Reusable helpers for the openblock chart. Mostly label / name generators
so a future operator can install multiple releases side by side without
collision.
*/}}

{{- define "openblock.fullname" -}}
{{- $name := default .Chart.Name .Values.fullnameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openblock.labels" -}}
app.kubernetes.io/name: openblock
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: openblock
{{- end -}}

{{- define "openblock.serviceLabels" -}}
{{- include "openblock.labels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "openblock.image" -}}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .image .Values.global.imageTag -}}
{{- end -}}
