import Foundation
import XCTest
@testable import ZhiZhouCore

final class PasskeySigningSupportTests: XCTestCase {
    func testPersonalProfileWithoutAssociatedDomainsIsRejected() throws {
        XCTAssertEqual(try inspect(entitlements: ["application-identifier": "TEAM.app"]), .notAuthorized)
        XCTAssertEqual(try inspect(entitlements: ["com.apple.developer.associated-domains": [String]()]), .notAuthorized)
    }

    func testProfileAuthorizationDoesNotProveSignedEntitlementOrWebsiteAssociation() throws {
        for domains in [["*"], ["webcredentials:catrr.uk"], ["applinks:example.com"]] {
            XCTAssertEqual(try inspect(entitlements: ["com.apple.developer.associated-domains": domains]), .notDetermined)
        }
    }

    func testMissingMalformedOrUnrecognizedProfileDoesNotDisableStoreBuilds() throws {
        XCTAssertEqual(PasskeySigningSupport.inspect(profileData: nil), .notDetermined)
        XCTAssertEqual(PasskeySigningSupport.inspect(profileData: Data("invalid".utf8)), .notDetermined)
        XCTAssertEqual(PasskeySigningSupport.inspect(profileData: Data("<plist>incomplete".utf8)), .notDetermined)
        XCTAssertEqual(try inspect(entitlements: ["com.apple.developer.associated-domains": true]), .notDetermined)
        let data = try PropertyListSerialization.data(fromPropertyList: ["Other": "value"], format: .xml, options: 0)
        XCTAssertEqual(PasskeySigningSupport.inspect(profileData: data), .notDetermined)
    }

    private func inspect(entitlements: [String: Any]) throws -> PasskeySigningSupport {
        let xml = try PropertyListSerialization.data(fromPropertyList: ["Entitlements": entitlements], format: .xml, options: 0)
        // CMS is binary, so extracting XML must not depend on decoding the whole
        // envelope as UTF-8. This is a framing fixture, not a signed CMS fixture.
        return PasskeySigningSupport.inspect(profileData: Data([0x30, 0x82, 0xff]) + xml + Data([0xff, 0x00]))
    }
}
