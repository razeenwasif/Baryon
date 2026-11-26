import Foundation
import AppKit
import PDFKit
import ImageIO
import Darwin
func fail(_ text: String) throws -> Never { throw NSError(domain:"FairyDocument",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
// limit is the longest side in pixels: 1600 for a model, more for reading in the window. ink draws the page as Fairy's
// look shows it: each colour's lightness turned over, keeping its hue, so dark words become light and a blue link stays
// blue, and each pixel as opaque as it is then bright, so the paper is see-through. The window shows it as a plain
// picture, with no filter to work out each time it draws.
func render(_ image: NSImage, limit: CGFloat = 1600, ink: Bool = false) throws -> [String:Any] {
    let size=image.size
    guard size.width>0,size.height>0,size.width.isFinite,size.height.isFinite else {try fail("Invalid page dimensions.")}
    let scale=min(1,limit/max(size.width,size.height)),w=max(1,Int(size.width*scale)),h=max(1,Int(size.height*scale))
    guard let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0),let context=NSGraphicsContext(bitmapImageRep:rep) else {try fail("Could not render document.")}
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=context
    NSColor.white.setFill();NSRect(x:0,y:0,width:w,height:h).fill()
    image.draw(in:NSRect(x:0,y:0,width:w,height:h));NSGraphicsContext.restoreGraphicsState()
    if ink {
        guard let bytes=rep.bitmapData else {try fail("Could not render document.")}
        let row=rep.bytesPerRow
        var opacity=[UInt8](repeating:0,count:256)
        for v in 0..<256 { opacity[v]=UInt8(min(255,(pow(Double(v)/255,0.8)*255).rounded())) }
        for y in 0..<h {
            let line=bytes+y*row
            for x in 0..<w {
                let p=line+x*4
                let r=Int(p[0]),g=Int(p[1]),b=Int(p[2])
                let shift=255-max(r,g,b)-min(r,g,b)
                let r2=r+shift,g2=g+shift,b2=b+shift
                let a=Int(opacity[min(255,max(0,(2126*r2+7152*g2+722*b2)/10000))])
                // Stored premultiplied, a little below white, as the window's own words are.
                p[0]=UInt8(r2*94/100*a/255);p[1]=UInt8(g2*94/100*a/255);p[2]=UInt8(b2*95/100*a/255);p[3]=UInt8(a)
            }
        }
        guard let data=rep.representation(using:.png,properties:[:]) else {try fail("Could not encode document image.")}
        return ["url":"data:image/png;base64,"+data.base64EncodedString(),"width":w,"height":h,"ink":true]
    }
    guard let data=rep.representation(using:.jpeg,properties:[.compressionFactor:0.9]) else {try fail("Could not encode document image.")}
    return ["url":"data:image/jpeg;base64,"+data.base64EncodedString(),"width":w,"height":h]
}
do {
    let input=FileHandle.standardInput.readDataToEndOfFile()
    guard input.count<=30*1024*1024,let payload=try JSONSerialization.jsonObject(with:input) as? [String:Any] else {try fail("Invalid document input.")}
    let data: Data
    if payload["descriptor"] as? Bool == true {
        var info = stat()
        guard fstat(3, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size > 0, info.st_size <= 256*1024*1024 else {try fail("Invalid or oversized PDF.")}
        data = FileHandle(fileDescriptor:3,closeOnDealloc:false).readDataToEndOfFile()
        guard data.count == info.st_size else {try fail("PDF changed during reading.")}
    } else {
        guard let encoded=payload["data"] as? String,let decoded=Data(base64Encoded:encoded),decoded.count<=20*1024*1024 else {try fail("Invalid document input.")}
        data=decoded
    }
    let limit=CGFloat(min(3200,max(800,payload["size"] as? Int ?? 1600)))
    let ink=payload["ink"] as? Bool == true
    if payload["index"] as? Bool == true {
        setpriority(PRIO_PROCESS,0,10)
        guard let pdf=PDFDocument(data:data),!pdf.isLocked else {try fail("PDF is unreadable or password protected.")}
        func emit(_ value:[String:Any]) throws {FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:value)+Data([10]))}
        var characters=0, processed=0, clipped=0, empty=0
        for i in 0..<min(pdf.pageCount,5000) {
            if characters>=32*1024*1024 {break}
            try autoreleasepool {
                let text=pdf.page(at:i)?.string ?? "",excerpt=String(text.prefix(20000))
                if text.count>20000 {clipped+=1}
                if excerpt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {empty+=1}
                try emit(["page":i+1,"text":excerpt]);characters+=excerpt.utf8.count;processed+=1
            }
        }
        try emit(["done":true,"totalPages":pdf.pageCount,"processedPages":processed,"emptyPages":empty,"clippedPages":clipped,"truncated":processed<pdf.pageCount || clipped>0])
        exit(0)
    }
    var result:[String:Any]=[:]
    // A paper's lines and where each sits (the notebook following the question you're on): per page, each visual line's
    // words and box as fractions of the page as shown, from its top left. Lines are worked out from the characters'
    // boxes, as a plain PDF can run several together in PDFKit's own lines. Pages from start, at most count (200).
    if payload["lines"] as? Bool == true {
        guard let pdf=PDFDocument(data:data), !pdf.isLocked else {try fail("PDF is unreadable or password protected.")}
        let start=max(1,payload["start"] as? Int ?? 1), count=max(1,min(200,payload["count"] as? Int ?? 200))
        guard start<=pdf.pageCount else {try fail("PDF page is outside this document.")}
        var pages:[[String:Any]]=[]
        for i in (start-1)..<min(pdf.pageCount,start-1+count) {
            autoreleasepool {
                guard let page=pdf.page(at:i) else {return}
                let box=page.bounds(for:.mediaBox)
                guard box.width>0,box.height>0 else {return}
                var lines:[[String:Any]]=[]
                if page.rotation==0 {
                    // Each line of the page's words, where PDFKit places that run of characters.
                    let text=(page.string ?? "") as NSString
                    var at=0
                    while at<text.length && lines.count<400 {
                        let range=text.lineRange(for:NSRange(location:at,length:0))
                        at=NSMaxRange(range)
                        let words=text.substring(with:range).trimmingCharacters(in:.whitespacesAndNewlines)
                        guard !words.isEmpty, let picked=page.selection(for:range) else {continue}
                        let b=picked.bounds(for:page)
                        guard !b.isNull, b.width>0, b.height>0, b.width.isFinite, b.height.isFinite else {continue}
                        lines.append(["x":(b.minX-box.minX)/box.width,"y":(box.maxY-b.maxY)/box.height,"w":b.width/box.width,"h":b.height/box.height,"text":String(words.prefix(400))])
                    }
                }
                pages.append(["page":i+1,"lines":lines])
            }
        }
        result["totalPages"]=pdf.pageCount;result["pages"]=pages
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result))
        exit(0)
    }
    if payload["image"] as? Bool == true && payload["pdf"] as? Bool != true {
        guard let source=CGImageSourceCreateWithData(data as CFData,nil),let props=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any],let w=props[kCGImagePropertyPixelWidth] as? Int,let h=props[kCGImagePropertyPixelHeight] as? Int,w>0,h>0,w<=16384,h<=16384,w*h<=60000000 else {try fail("Invalid or oversized image.")}
        guard let thumbnail=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:Int(limit),kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else {try fail("Unsupported image.")}
        result=try render(NSImage(cgImage:thumbnail,size:NSSize(width:thumbnail.width,height:thumbnail.height)),limit:limit)
    } else {
        guard let pdf=PDFDocument(data:data), !pdf.isLocked else {try fail("PDF is unreadable or password protected.")}
        let start=payload["start"] as? Int ?? 1, count=max(1,min(64,payload["count"] as? Int ?? 64))
        guard start>=1,start<=pdf.pageCount else {try fail("PDF page is outside this document.")}
        result["totalPages"]=pdf.pageCount
        if payload["image"] as? Bool == true, let clip=payload["clip"] as? [Double] {
            // A clipping (the notebook's paper view): part of a page, given as fractions of the page as shown, from its
            // top left. widen grows it to every line of words it touches (never smaller, so a figure in it stays), on a
            // page that isn't turned; the words in it come back with it, and the box as it ended up.
            guard let page=pdf.page(at:start-1) else {try fail("PDF page unavailable.")}
            let box=page.bounds(for:.mediaBox)
            guard box.width>0,box.height>0,box.width.isFinite,box.height.isFinite else {try fail("Invalid PDF dimensions.")}
            guard clip.count==4,clip.allSatisfy({$0.isFinite}) else {try fail("Not a box on the page.")}
            let x=max(0,min(1,clip[0])),y=max(0,min(1,clip[1]))
            var rect=CGRect(x:x,y:y,width:max(0,min(1-x,clip[2])),height:max(0,min(1-y,clip[3])))
            guard rect.width>=0.01,rect.height>=0.005 else {try fail("Draw a bigger box.")}
            var words=""
            if page.rotation==0 {
                let toPage={(r:CGRect)->CGRect in CGRect(x:box.minX+r.minX*box.width,y:box.maxY-r.maxY*box.height,width:r.width*box.width,height:r.height*box.height)}
                var area=toPage(rect)
                // Each character's box, as PDFKit places it: lines grouped by PDFKit can run several lines together in
                // a plain PDF, so lines are worked out here from the characters themselves.
                let text=(page.string ?? "") as NSString
                let n=min(text.length,page.numberOfCharacters,60000)
                var boxes=[CGRect](repeating:.null,count:n)
                for i in 0..<n {let r=page.characterBounds(at:i);if r.width>0,r.height>0,r.width.isFinite,r.height.isFinite {boxes[i]=r}}
                if payload["widen"] as? Bool == true {
                    // A character inside the box takes in its line, along the run of characters that are close to the
                    // next, so a line grows to its ends but stops at a gap like a column's.
                    let drawn=area,placed=(0..<n).filter{!boxes[$0].isNull}
                    var taken=Set<Int>()
                    for t in placed where !taken.contains(t) && drawn.contains(CGPoint(x:boxes[t].midX,y:boxes[t].midY)) {
                        let tb=boxes[t]
                        let line=placed.filter{abs(boxes[$0].midY-tb.midY)<=tb.height*0.35 && abs(boxes[$0].height-tb.height)<=tb.height*0.6}.sorted{boxes[$0].midX<boxes[$1].midX}
                        guard var low=line.firstIndex(of:t) else {continue}
                        var high=low;let gap=tb.height*2.5
                        while low>0 && boxes[line[low]].minX-boxes[line[low-1]].maxX<gap {low-=1}
                        while high<line.count-1 && boxes[line[high+1]].minX-boxes[line[high]].maxX<gap {high+=1}
                        for k in low...high {area=area.union(boxes[line[k]]);taken.insert(line[k])}
                    }
                    area=area.insetBy(dx:-3,dy:-1).intersection(box)
                    rect=CGRect(x:(area.minX-box.minX)/box.width,y:(box.maxY-area.maxY)/box.height,width:area.width/box.width,height:area.height/box.height)
                }
                // The words in it: each character whose middle is inside, and the spaces and line ends that follow one.
                var units:[unichar]=[],kept=false
                for i in 0..<n {
                    if boxes[i].isNull {if kept {units.append(text.character(at:i))};continue}
                    kept=area.contains(CGPoint(x:boxes[i].midX,y:boxes[i].midY))
                    if kept {units.append(text.character(at:i))}
                }
                words=String(utf16CodeUnits:units,count:units.count)
            }
            // Drawn big enough for the clipping's longest side to be about limit pixels, with the page at most 4000.
            let points=max(rect.width*box.width,rect.height*box.height)
            let scale=min(limit/max(1,points),4000/max(box.width,box.height))
            let full=page.thumbnail(of:NSSize(width:box.width*scale,height:box.height*scale),for:.mediaBox)
            guard let picture=full.cgImage(forProposedRect:nil,context:nil,hints:nil) else {try fail("Could not render document.")}
            let w=CGFloat(picture.width),h=CGFloat(picture.height)
            guard let part=picture.cropping(to:CGRect(x:rect.minX*w,y:rect.minY*h,width:rect.width*w,height:rect.height*h).integral) else {try fail("Could not render document.")}
            result.merge(try render(NSImage(cgImage:part,size:NSSize(width:part.width,height:part.height)),limit:limit,ink:ink)){_,new in new}
            result["page"]=start
            result["box"]=[rect.minX,rect.minY,rect.width,rect.height]
            result["words"]=String(words.prefix(4000))
        } else if payload["image"] as? Bool == true {
            guard let page=pdf.page(at:start-1) else {try fail("PDF page unavailable.")}
            let box=page.bounds(for:.mediaBox)
            guard box.width>0,box.height>0,box.width.isFinite,box.height.isFinite else {try fail("Invalid PDF dimensions.")}
            let scale=limit/max(box.width,box.height)
            result.merge(try render(page.thumbnail(of:NSSize(width:box.width*scale,height:box.height*scale),for:.mediaBox),limit:limit,ink:ink)){_,new in new}
            result["page"]=start
        } else {
            var pages:[[String:Any]]=[];var characters=0;var next=start
            for i in (start-1)..<min(pdf.pageCount,start-1+count) {
                let text=pdf.page(at:i)?.string ?? "",excerpt=String(text.prefix(48000))
                if !pages.isEmpty && characters+excerpt.count>48000 {break}
                pages.append(["page":i+1,"text":excerpt,"truncated":text.count>48000,"needsVision":text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty])
                characters+=excerpt.count;next=i+2
            }
            result["pages"]=pages;result["nextPage"]=next<=pdf.pageCount ? next : NSNull();result["truncated"]=next<=pdf.pageCount || pages.contains{($0["truncated"] as? Bool)==true}
        }
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result))
} catch {
    let result=["error":(error as NSError).domain=="FairyDocument" ? error.localizedDescription : "Document parsing failed."]
    if let out=try? JSONSerialization.data(withJSONObject:result){FileHandle.standardOutput.write(out)}
    exit(1)
}
