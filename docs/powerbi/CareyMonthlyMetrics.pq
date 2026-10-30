// Create a blank query named CareyMonthlyMetrics. CareyKPIEvents is the
// existing SharePoint List source query; change only that name if necessary.
let
    Source = CareyKPIEvents,
    SummaryItems = Table.SelectRows(Source, each [eventType] = "monthly_report"),
    SummaryFields = Table.SelectColumns(SummaryItems, {"eventId", "eventJson"}),
    Parsed = Table.AddColumn(SummaryFields, "Report", each Json.Document([eventJson]), type record),
    Validated = Table.AddColumn(Parsed, "ValidatedReport", each
        if [Report][schemaVersion] <> "carey-kpi-monthly-report-v1" or
           [eventId] <> ("kpi-report:" & [Report][monthSGT]) then
            error "Unexpected monthly KPI summary. Check the flow and report version."
        else [Report], type record),
    Envelopes = Table.ExpandRecordColumn(
        Table.SelectColumns(Validated, {"ValidatedReport"}), "ValidatedReport",
        {"monthSGT", "asOf", "revision", "definitionVersion", "policyVersion", "provisional",
         "collectionEnabled", "pendingEvents", "receiverConfigured", "metrics"}),
    UniqueMonths = if Table.RowCount(Envelopes) <> List.Count(List.Distinct(Envelopes[monthSGT])) then
        error "Duplicate monthly summaries. Enforce unique eventId values in the KPI List."
        else Envelopes,
    MetricList = Table.ExpandListColumn(UniqueMonths, "metrics"),
    MetricRows = Table.ExpandRecordColumn(MetricList, "metrics",
        {"metricCode", "metricLabel", "group", "unit", "value", "numerator", "denominator", "status", "note"}),
    Typed = Table.TransformColumnTypes(MetricRows, {
        {"monthSGT", type text}, {"asOf", type datetimezone}, {"revision", type text},
        {"definitionVersion", type text}, {"policyVersion", type text}, {"provisional", type logical},
        {"collectionEnabled", type logical}, {"pendingEvents", Int64.Type}, {"receiverConfigured", type logical},
        {"metricCode", type text}, {"metricLabel", type text}, {"group", type text}, {"unit", type text},
        {"value", type number}, {"numerator", Int64.Type}, {"denominator", Int64.Type},
        {"status", type text}, {"note", type text}
    }),
    WithMonthStart = Table.AddColumn(Typed, "monthStart", each Date.FromText([monthSGT] & "-01"), type date)
in
    WithMonthStart
