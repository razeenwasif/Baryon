#if DEBUG
import UIKit

// Made-up Study notebooks for -FairyDemo: one notebook with a past paper as a PDF and a shelf of clippings from a paper,
// a note and a page, so the Study tab and the shelf beside a paper can be seen in the Simulator with no Mac.
extension Demo {
    static func study(_ route: String, _ query: [String: String]) -> Data? {
        let json: String
        switch route {
        case "notebooks":
            json = #"{"notebooks":[{"slug":"comp2310","title":"COMP2310","course":"Systems programming","exam":"2026-11-24","daysToExam":7,"archived":false,"sources":3,"notes":1,"chats":0,"cardsDue":4,"heldBy":null}]}"#
        case "notebook":
            json = #"""
            {"slug":"comp2310","title":"COMP2310","course":"Systems programming","exam":"2026-11-24","daysToExam":7,"categories":[],
             "sources":[{"id":"S01","title":"COMP2310 Final Exam 2025.pdf","kind":"pdf","role":"a past exam paper","units":"pages","count":2,"state":"ready","hasWords":true,"category":null,"pdf":true},
                        {"id":"S20","title":"week9-cache-memories.pdf","kind":"pdf","role":"a lecture's slides","units":"pages","count":60,"state":"ready","hasWords":true,"category":null,"pdf":true},
                        {"id":"S26","title":"comp2310_systems_cheatsheet.pdf","kind":"pdf","role":"a reading","units":"pages","count":3,"state":"ready","hasWords":true,"category":null,"pdf":true}],
             "notes":[{"id":"N001","title":"Cache cheats","updated":1794900000,"words":40}],"files":[],"chats":[],"made":[],
             "flashcards":{"due":4,"decks":[]},
             "clips":[{"id":"CL003","title":"Components of the physical address","from":"week5-vm-systems · p.4","words":null,"picture":true},
                      {"id":"CL002","title":"Miss types","from":"Your note “Cache cheats”","words":"## Miss types\nCold: first touch of a block. **Conflict**: two blocks fight over one set. Capacity: the working set is too big.","picture":false},
                      {"id":"CL001","title":"From potential to force","from":"The page “Anatomy of a Timestep”","words":"From potential to force","picture":true}]}
            """#
        case "notebook-source":
            json = #"{"id":"\#(query["id"] ?? "S01")","title":"COMP2310 Final Exam 2025.pdf","pdf":true,"units":"pages","total":2,"page":1,"text":"Problem 4. Memory Hierarchy"}"#
        case "notebook-clip-picture":
            return try? JSONSerialization.data(withJSONObject: ["url": "data:image/jpeg;base64,\(clipPicture(query["id"] ?? "").base64EncodedString())"])
        default: return nil
        }
        return Data(json.utf8)
    }

    // A clipping's picture, drawn as the Mac would send it.
    static func clipPicture(_ id: String) -> Data {
        let lines = id == "CL001" ? ["From potential to force", "The force on atom i is minus the gradient of V with", "respect to its position: one scalar H times a difference."]
            : ["Components of the physical address (PA)", "  PPO: Physical page offset (same as VPO)", "  PPN: Physical page number", "  CO: Byte offset within cache line", "  CI: Cache index", "  CT: Cache tag"]
        let size = CGSize(width: 900, height: 60 + CGFloat(lines.count) * 46)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(red: 0.04, green: 0.05, blue: 0.09, alpha: 1).setFill(); context.fill(CGRect(origin: .zero, size: size))
            for (i, line) in lines.enumerated() {
                let font = i == 0 ? UIFont.boldSystemFont(ofSize: 34) : UIFont.systemFont(ofSize: 30)
                (line as NSString).draw(at: CGPoint(x: 30, y: 26 + CGFloat(i) * 46), withAttributes: [.font: font, .foregroundColor: UIColor(white: 0.93, alpha: 1)])
            }
        }
        return image.jpegData(compressionQuality: 0.85) ?? Data()
    }

    // A past paper as a PDF, two pages of questions.
    static func studyPDF() -> URL {
        let url = URL.temporaryDirectory.appending(path: "demo-paper-\(UUID().uuidString).pdf")
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        try? UIGraphicsPDFRenderer(bounds: page).writePDF(to: url) { context in
            for text in ["Problem 4. (12 points): Memory Hierarchy\n\nPart 1  The box below shows the format of a physical address. Indicate the fields that would be used to determine the following:\n\n  CO  The block offset within the cache line\n  CI  The cache index\n  CT  The cache tag\n\nPart 2  For the given physical address, indicate the cache entry accessed and the cache byte value returned in hex. Indicate whether a cache miss occurs.",
                         "Problem 5. Exceptional Control Flow (8 points)\n\nPart I  Answer the following questions about this C code:\n\n  int counter = 12;\n  int main(void) {\n    for (int i = 0; i < 2; i++) { fork(); counter++; }\n    printf(\"counter = %d\\n\", counter);\n  }\n\nHow many lines are printed, and what are they?"] {
                context.beginPage()
                (text as NSString).draw(in: page.insetBy(dx: 56, dy: 64), withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black])
            }
        }
        return url
    }
}
#endif
