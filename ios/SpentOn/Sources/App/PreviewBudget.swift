#if DEBUG
import Foundation

// Fictional, in-memory stress fixture. Never loaded by a release build or saved to the service.
enum PreviewBudget {
    static func manyCategories(_ budget: JSONValue) -> JSONValue {
        guard case .object(var fields) = budget, case .array(var categories) = fields["categories"] else { return budget }
        func category(_ id: String, name: String, group: String, parent: String? = nil) -> JSONValue {
            var fields: [String: JSONValue] = ["id": .string(id), "name": .string(name), "group": .string(group), "icon": .string("basket"), "target": .number(0), "targetType": .string("monthly"), "color": .string("sage")]
            if let parent { fields["parentId"] = .string(parent) }
            return .object(fields)
        }
        for index in 1...240 {
            categories.append(category("preview-\(index)", name: String(format: "Category %03d", index), group: String(format: "Group %02d", (index - 1) / 20 + 1)))
        }
        categories.append(category("preview-travel", name: "International travel", group: "Travel"))
        categories.append(category("preview-airport", name: "Airport meals and refreshments during long international trips", group: "Travel", parent: "preview-travel"))
        categories.append(category("preview-work", name: "Work", group: "Everyday needs"))
        categories.append(category("preview-personal", name: "Personal", group: "Everyday needs"))
        categories.append(category("preview-work-meals", name: "Meals", group: "Everyday needs", parent: "preview-work"))
        categories.append(category("preview-personal-meals", name: "Meals", group: "Everyday needs", parent: "preview-personal"))
        fields["categories"] = .array(categories)
        return .object(fields)
    }
}
#endif
