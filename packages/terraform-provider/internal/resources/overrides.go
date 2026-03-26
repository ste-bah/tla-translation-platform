package resources

// ApplyOverrides performs a shallow merge of overrides into the base attrs map.
// Override values take precedence over base values.
func ApplyOverrides(base map[string]any, overrides map[string]string) map[string]any {
	if len(overrides) == 0 {
		return base
	}
	for k, v := range overrides {
		base[k] = v
	}
	return base
}
