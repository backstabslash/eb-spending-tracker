{{- define "spending-tracker.fullname" -}}
{{- .Release.Name }}-{{ .Chart.Name }}
{{- end }}

{{- define "spending-tracker.secretName" -}}
{{ .Release.Name }}-secrets
{{- end }}
