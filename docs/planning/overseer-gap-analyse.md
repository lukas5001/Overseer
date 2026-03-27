# Overseer vs. Markt — Feature Gap Analyse

## Was Overseer bereits gut macht
- Push-basiertes Monitoring mit Agent + Collector
- Multi-Tenancy mit ORM-Level Isolation
- 23 Agent-Check-Typen + Remote-Checks (SNMP, SSH, HTTP, Ping)
- Alert Rules mit Escalation Policies
- SLA-Tracking mit Downtime-Berücksichtigung
- Recurring Downtimes (RRULE)
- TV-Mode für Wall Displays
- AI-Service (Ollama-basierte Diagnose)
- Field-Level Encryption (AES-256-GCM)
- 2FA (Email + TOTP)
- Audit Log
- Service Templates mit Vendor/Category
- Global Check Policies
- Config Export/Import
- Saved Filters
- Soft/Hard State Transitions

---

## Was fehlt — nach Kategorie

### 1. APPLICATION PERFORMANCE MONITORING (APM)
**Wer hat's:** Datadog, Dynatrace, New Relic, Splunk, Elastic

| Feature | Beschreibung |
|---------|-------------|
| Distributed Tracing | End-to-End Request-Verfolgung über Microservices hinweg |
| Service Maps / Dependency Maps | Auto-generierte Topologie der Service-Abhängigkeiten |
| Code-Level Profiling | CPU/Memory-Profiling auf Methoden-Ebene in Production |
| Error Tracking & Grouping | Automatisches Gruppieren und Priorisieren von Application Errors |
| Database Query Performance | Explain Plans, Query-Metriken, langsame Queries erkennen |
| Service-Level Latency Analysis | P50/P95/P99 Latenz-Tracking pro Service |

**Relevanz für Overseer:** Eher gering — Overseer ist ein Infrastructure-Monitoring-Tool, kein APM. Könnte aber als Add-on-Modul interessant sein.

---

### 2. LOG MANAGEMENT
**Wer hat's:** Datadog, Dynatrace, Splunk (Kernkompetenz), Elastic, New Relic

| Feature | Beschreibung |
|---------|-------------|
| Zentrales Log-Sammeln & Indexieren | Logs von allen Hosts/Services einsammeln und durchsuchbar machen |
| Log-Pipelines | Parsen, Anreichern, Routen von Logs mit Processing-Regeln |
| Log-Suche & Analyse | Volltext-Suche, Pattern Detection, Anomaly Detection |
| Log-Korrelation mit Metriken | Logs mit Check-Ergebnissen und Statusänderungen verknüpfen |
| Sensitive Data Scanner | Sensible Daten in Logs automatisch erkennen und maskieren |
| Log-basierte Alerts | Alerts basierend auf Log-Patterns auslösen |

**Relevanz:** HOCH — Overseer hat `agent_eventlog` für Windows/Linux, aber kein zentrales Log-Management. Das ist eines der größten Gaps.

---

### 3. DASHBOARDS & VISUALISIERUNG
**Wer hat's:** Alle Konkurrenten

| Feature | Beschreibung |
|---------|-------------|
| Custom Dashboards (Drag & Drop) | Benutzer erstellen eigene Dashboards mit frei platzierbaren Widgets |
| Diverse Chart-Typen | Line, Bar, Pie, Heatmap, Gauge, Geo-Map, Stacked Area |
| Dashboard Templates | Vorgefertigte Dashboards für gängige Use Cases |
| Dashboard Sharing / Public Links | Dashboards per Link mit Externen teilen |
| Template Variables / Dropdown Filter | Dynamische Dashboards mit wechselbaren Host/Tenant-Filtern |
| Netzwerk-Topologie-Maps | Interaktive Karten mit Live-Status der Netzwerk-Topologie |
| Annotations | Events auf Zeitreihen-Graphen markieren (Deployments, Incidents) |
| Composite/Combined Graphs | Mehrere Metriken in einem Graph übereinanderlegen |

**Relevanz:** HOCH — Overseer hat Mini-Graphs und eine Error-Übersicht, aber keine frei konfigurierbaren Dashboards. Das ist ein großer UX-Gap.

---

### 4. AUTO-DISCOVERY
**Wer hat's:** Dynatrace, Zabbix, CheckMK, Datadog, New Relic

| Feature | Beschreibung |
|---------|-------------|
| Netzwerk-Scan Discovery | IP-Range scannen und Hosts automatisch hinzufügen |
| Service Auto-Discovery | Automatisch erkennen welche Services auf einem Host laufen |
| SNMP OID Discovery | Interfaces, Storage, Sensoren automatisch entdecken |
| Cloud Resource Discovery | AWS/Azure/GCP-Ressourcen automatisch importieren |
| Container/Pod Discovery | Docker/K8s-Workloads automatisch erkennen |
| Agent Auto-Registration | Agent registriert sich selbst beim Server ohne manuelle Config |

**Relevanz:** HOCH — Overseer erfordert manuelle Host/Service-Konfiguration. Auto-Discovery spart massiv Zeit bei Onboarding neuer Kunden.

---

### 5. NETZWERK-MONITORING (Erweitert)
**Wer hat's:** Zabbix, CheckMK, Datadog

| Feature | Beschreibung |
|---------|-------------|
| SNMP v3 Support (voll) | Auth + Privacy (authPriv) für sichere SNMP-Abfragen |
| SNMP Trap Empfang | Passiv SNMP Traps empfangen statt nur pollen |
| NetFlow / sFlow Analyse | Traffic-Analyse, Top Talkers, Bandwidth-Monitoring |
| Network Topology Maps | Auto-generierte, interaktive Netzwerk-Karten mit Live-Status |
| Trigger Dependencies | Unterdrücke Child-Alerts wenn Parent-Device down ist |
| Bandwidth Monitoring | Interface-Level Traffic-Monitoring mit historischen Daten |

**Relevanz:** MITTEL-HOCH — Overseer hat SNMP-Basics, aber keine Traps, kein NetFlow, keine Topology Maps, keine Trigger Dependencies.

---

### 6. CLOUD & CONTAINER MONITORING
**Wer hat's:** Datadog, Dynatrace, New Relic, CheckMK, Elastic

| Feature | Beschreibung |
|---------|-------------|
| AWS/Azure/GCP-Integrationen | Native Cloud-Service-Metriken (EC2, RDS, S3, Lambda, etc.) |
| Kubernetes Monitoring | Cluster, Nodes, Pods, Namespaces, Deployments |
| Docker Container Monitoring | Container-Health, Resource Usage, Restart-Tracking |
| Serverless Monitoring | Lambda/Functions-Ausführung tracken |
| Cloud Cost Management | Cloud-Spend pro Team/Service/Environment tracken |
| VMware/vSphere Integration | ESXi Hosts, VMs, Datastores monitoren |

**Relevanz:** MITTEL — Hängt von der Zielgruppe ab. Für MSPs die SMB-Kunden betreuen weniger relevant, für größere Umgebungen sehr relevant.

---

### 7. SYNTHETIC MONITORING
**Wer hat's:** Datadog, Dynatrace, New Relic, Splunk, CheckMK, Uptime Kuma

| Feature | Beschreibung |
|---------|-------------|
| HTTP/API Endpoint Tests | Regelmäßige API-Calls mit Status/Response-Validierung |
| Browser-basierte Tests | Headless-Browser simuliert User-Interaktionen (Login-Flow, etc.) |
| Multi-Step Transactions | Verkettete Checks die einen Workflow simulieren |
| Multi-Location Testing | Tests von verschiedenen Standorten weltweit |
| SSL/TLS Certificate Monitoring | Zertifikats-Ablauf überwachen und warnen |
| DNS Monitoring | DNS-Auflösung und Record-Änderungen überwachen |

**Relevanz:** MITTEL-HOCH — Overseer hat `http`-Checks und `port`-Checks, aber kein Browser-Testing, kein SSL-Monitoring, kein DNS-Check, keine Multi-Location.

---

### 8. INCIDENT MANAGEMENT
**Wer hat's:** Datadog, New Relic, Splunk, Grafana

| Feature | Beschreibung |
|---------|-------------|
| Incident Declaration & Tracking | Incidents erstellen, Status tracken, Timelines |
| On-Call Scheduling | Bereitschaftspläne mit Rotation |
| On-Call Escalation | Automatische Eskalation wenn niemand reagiert |
| Status Pages (Public) | Öffentliche Status-Seiten für Kunden (à la statuspage.io) |
| Post-Incident Reviews | Postmortem-Templates und -Tracking |
| War Room / Collaboration | Kollaborations-Channels pro Incident |
| Runbooks | Dokumentierte Reaktionspläne, verlinkt mit Alerts |

**Relevanz:** MITTEL — Overseer hat Acknowledgments und Escalation Policies, aber kein vollständiges Incident Management. Status Pages wären ein starkes Feature für MSPs.

---

### 9. NOTIFICATION CHANNELS (Erweitert)
**Wer hat's:** Alle, besonders Uptime Kuma (95+ Channels)

| Feature | Beschreibung |
|---------|-------------|
| Slack Integration | Native Slack-Benachrichtigungen |
| Microsoft Teams | Native Teams-Benachrichtigungen |
| Telegram | Telegram Bot-Integration |
| PagerDuty / OpsGenie | Integration mit Incident-Response-Tools |
| SMS (Twilio etc.) | SMS-Benachrichtigungen |
| Push Notifications (Mobile App) | Mobile Push-Benachrichtigungen |
| Notification Templates | Anpassbare Nachrichtenformate pro Kanal |
| Notification Throttling / Deduplication | Alert-Fatigue verhindern durch Zusammenfassen |
| Alert Grouping | Verwandte Alerts zu einer Benachrichtigung bündeln |
| Alert Suppression / Inhibition | Alerts unterdrücken wenn übergeordneter Alert aktiv |

**Relevanz:** HOCH — Overseer hat Webhook + Email. Slack, Teams, Telegram, PagerDuty wären Quick Wins. Alert Grouping und Suppression sind kritisch gegen Alert Fatigue.

---

### 10. AI & MACHINE LEARNING
**Wer hat's:** Datadog (Bits AI), Dynatrace (Davis AI), New Relic, Splunk, Elastic

| Feature | Beschreibung |
|---------|-------------|
| Anomaly Detection | ML erkennt automatisch ungewöhnliche Metrik-Patterns |
| Predictive Alerting | Vorhersage wann Ressourcen erschöpft sein werden (Disk voll in X Tagen) |
| Automatic Root Cause Analysis | AI identifiziert die Ursache kaskadierender Fehler |
| Natural Language Queries | "Zeige mir alle Hosts mit hoher CPU letzte Woche" |
| AI-gestützte Log-Analyse | Automatische Pattern-Erkennung und Zusammenfassung in Logs |
| Intelligent Alert Correlation | AI erkennt zusammenhängende Alerts und reduziert Noise |

**Relevanz:** MITTEL — Overseer hat bereits einen AI-Service (Ollama). Anomaly Detection und Predictive Alerts wären die wertvollsten Erweiterungen.

---

### 11. REPORTING
**Wer hat's:** Zabbix, CheckMK, Nagios XI, Datadog

| Feature | Beschreibung |
|---------|-------------|
| Scheduled PDF Reports | Automatisch generierte Reports per E-Mail (täglich/wöchentlich/monatlich) |
| Executive Summary Reports | Zusammenfassungen für Management (nicht-technisch) |
| Capacity Planning Reports | Trends und Prognosen für Ressourcen-Planung |
| Custom Report Builder | Eigene Reports zusammenstellen |
| Compliance Reporting | PCI, HIPAA, GDPR-konforme Berichte |
| Report Branding | Logo/Branding des MSP auf Reports für Kunden |

**Relevanz:** SEHR HOCH für MSPs — Kunden wollen Reports. Overseer hat SLA-Tracking, aber keine generierten Reports. Branded PDF-Reports wären ein Killer-Feature für MSPs.

---

### 12. KONFIGURATIONSMANAGEMENT & INVENTORY
**Wer hat's:** CheckMK, Zabbix, Dynatrace

| Feature | Beschreibung |
|---------|-------------|
| Hardware Inventory | Automatische HW-Erkennung (CPU-Modell, RAM, Seriennummern) |
| Software Inventory | Installierte Software und Versionen auflisten |
| Configuration Tracking | Konfigurationsänderungen über Zeit tracken |
| License Management | Software-Lizenzen tracken |
| CMDB Integration | Integration mit Configuration Management Databases |

**Relevanz:** MITTEL — Nützlich für MSPs die auch Asset Management machen.

---

### 13. BENUTZER-EXPERIENCE & UI
**Wer hat's:** Diverse

| Feature | Beschreibung |
|---------|-------------|
| Dark Mode / Theme Switching | UI-Themes für verschiedene Präferenzen |
| Mobile App / Responsive UI | Native App oder responsive Web-UI für unterwegs |
| Keyboard Shortcuts | Power-User-Navigation |
| Search / Command Palette | Globale Suche über alle Hosts/Services/Alerts |
| Bulk Operations | Massen-Operationen (100 Services auf einmal erstellen/bearbeiten) |
| Drag & Drop Configuration | Visuelle Konfiguration statt nur Formulare |
| Real-Time Updates (WebSocket) | Live-Updates ohne Page Refresh |
| Customizable Table Columns | Benutzer wählt welche Spalten angezeigt werden |
| User Preferences / Personalization | Startseite, Default-Filter, Sprache pro User |

**Relevanz:** MITTEL — Overseer hat Saved Filters und TV-Mode. Mobile App und globale Suche wären starke UX-Verbesserungen.

---

### 14. API & INTEGRATIONEN
**Wer hat's:** Alle Enterprise-Tools

| Feature | Beschreibung |
|---------|-------------|
| OpenTelemetry Support | OTel-Daten empfangen und verarbeiten |
| Grafana Integration | Overseer als Grafana Data Source |
| Terraform Provider | Infrastructure-as-Code für Monitoring-Config |
| Ansible/Puppet Integration | Automatisierte Agent-Deployments |
| ServiceNow Integration | Bidirektionales Ticket-Management |
| ITSM Integration (Jira, etc.) | Auto-Ticket-Erstellung bei Incidents |
| SSO (SAML/OIDC) | Single Sign-On für Enterprise-Kunden |
| LDAP/Active Directory | Zentrale Benutzerverwaltung |
| API Rate Limit Dashboard | Transparenz über API-Nutzung |

**Relevanz:** HOCH — SSO/LDAP ist für Enterprise-Kunden oft ein Muss. Jira/ServiceNow-Integration ist für MSPs sehr wertvoll.

---

### 15. SKALIERUNG & HIGH AVAILABILITY
**Wer hat's:** Zabbix, CheckMK, Dynatrace, Datadog

| Feature | Beschreibung |
|---------|-------------|
| Native HA Cluster | Automatisches Failover bei Server-Ausfall |
| Proxy/Relay für Remote-Sites | Leichtgewichtige Proxies in entfernten Netzwerken |
| Horizontal Scaling | Automatische Lastverteilung über mehrere Instanzen |
| Data Retention Policies | Konfigurierbare Aufbewahrungsfristen mit automatischer Aggregation |
| Database Sharding / Partitioning | Skalierung der Datenhaltung |

**Relevanz:** MITTEL — Overseer hat Redis-basiertes Locking und skalierbare Worker, aber kein dokumentiertes HA-Setup. Für größere Deployments relevant.

---

### 16. SECURITY MONITORING
**Wer hat's:** Datadog, Splunk, Elastic, Dynatrace

| Feature | Beschreibung |
|---------|-------------|
| SIEM (Security Event Correlation) | Sicherheits-Events korrelieren und Threats erkennen |
| Vulnerability Scanning | Bekannte CVEs in laufender Software erkennen |
| Compliance Auditing | Automatische Prüfung gegen Security-Standards |
| Cloud Security Posture Management | Fehlkonfigurationen in Cloud-Umgebungen finden |

**Relevanz:** GERING für Overseer's Kernmarkt — das ist ein komplett anderes Produktsegment.

---

## Priorisierte Empfehlung: Top 10 Features für "Marktdominanz"

| Prio | Feature | Warum |
|------|---------|-------|
| 1 | **Custom Dashboards** (Drag & Drop) | Jeder Konkurrent hat das. Ohne das wirkt ein Monitoring-Tool unfertig. |
| 2 | **Scheduled PDF Reports** (branded) | Killer-Feature für MSPs — Kunden zahlen dafür. |
| 3 | **Mehr Notification Channels** (Slack, Teams, Telegram, PagerDuty) | Quick Win, hoher Impact. Webhook allein reicht nicht. |
| 4 | **Auto-Discovery** (Netzwerk-Scan + Service-Discovery) | Spart Stunden beim Kunden-Onboarding. |
| 5 | **Zentrales Log Management** | Einer der häufigsten Gründe warum Leute zu einem "großen" Tool greifen. |
| 6 | **Status Pages** (public, branded) | MSPs können ihren Kunden Status-Seiten anbieten. |
| 7 | **SSL/TLS Certificate Monitoring** | Jeder braucht das, fast kein Aufwand zu implementieren. |
| 8 | **Alert Grouping / Suppression / Dependencies** | Gegen Alert Fatigue — kritisch ab einer gewissen Größe. |
| 9 | **SSO (SAML/OIDC) + LDAP** | Enterprise-Blocker — ohne SSO kein Enterprise-Deal. |
| 10 | **Anomaly Detection / Predictive Alerts** | Differenzierung gegenüber Zabbix/CheckMK. Overseer hat schon AI-Infrastruktur. |
