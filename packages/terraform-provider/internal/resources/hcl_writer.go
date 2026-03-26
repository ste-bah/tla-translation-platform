package resources

import (
	"fmt"
	"io"
	"sort"
)

// WriteResourceBlock writes a properly formatted HCL resource block to the writer.
func WriteResourceBlock(w io.Writer, resType, name string, attrs map[string]any) error {
	if _, err := fmt.Fprintf(w, "resource %q %q {\n", resType, name); err != nil {
		return err
	}
	if err := writeAttrs(w, attrs, "  "); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(w, "}"); err != nil {
		return err
	}
	return nil
}

func writeAttrs(w io.Writer, attrs map[string]any, indent string) error {
	// Sort keys for deterministic output.
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		v := attrs[k]
		switch val := v.(type) {
		case map[string]any:
			// Nested block
			if _, err := fmt.Fprintf(w, "%s%s {\n", indent, k); err != nil {
				return err
			}
			if err := writeAttrs(w, val, indent+"  "); err != nil {
				return err
			}
			if _, err := fmt.Fprintf(w, "%s}\n", indent); err != nil {
				return err
			}
		case string:
			if _, err := fmt.Fprintf(w, "%s%s = %q\n", indent, k, val); err != nil {
				return err
			}
		case bool:
			if _, err := fmt.Fprintf(w, "%s%s = %t\n", indent, k, val); err != nil {
				return err
			}
		case int:
			if _, err := fmt.Fprintf(w, "%s%s = %d\n", indent, k, val); err != nil {
				return err
			}
		case map[string]string:
			// Tags/labels block
			if _, err := fmt.Fprintf(w, "%s%s = {\n", indent, k); err != nil {
				return err
			}
			tagKeys := make([]string, 0, len(val))
			for tk := range val {
				tagKeys = append(tagKeys, tk)
			}
			sort.Strings(tagKeys)
			for _, tk := range tagKeys {
				if _, err := fmt.Fprintf(w, "%s  %s = %q\n", indent, tk, val[tk]); err != nil {
					return err
				}
			}
			if _, err := fmt.Fprintf(w, "%s}\n", indent); err != nil {
				return err
			}
		default:
			if _, err := fmt.Fprintf(w, "%s%s = %q\n", indent, k, fmt.Sprintf("%v", val)); err != nil {
				return err
			}
		}
	}
	return nil
}
